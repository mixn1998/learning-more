import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { createMigrationPlan } from './migration-plan.js';
import type { SchemaRegistry, VerificationIssue } from './schema-registry.js';
import { acquireStoreMaintenanceLease } from './store-maintenance-lease.js';
import { verifyStore } from './verify-store.js';

type ActiveStorePointer = Readonly<{
  relativePath: string;
  generation: number;
  updatedAt: string;
}>;

export type MigrationFaultPoint =
  'candidate_copied' | 'transformed' | 'verified' | 'pointer_switched';

function assertSafeRelative(value: string): void {
  if (value === '' || path.isAbsolute(value) || value.split(/[\\/]/).includes('..')) {
    throw new Error('active_store_pointer_invalid');
  }
}

async function fileReceipts(root: string, directory = root): Promise<Record<string, string>> {
  const receipts: Record<string, string> = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) Object.assign(receipts, await fileReceipts(root, absolute));
    else {
      const relative = path.relative(root, absolute).replaceAll('\\', '/');
      receipts[relative] = createHash('sha256')
        .update(await readFile(absolute))
        .digest('hex');
    }
  }
  return receipts;
}

function blocking(issues: readonly VerificationIssue[]): boolean {
  return issues.some((issue) => issue.severity !== 'warning');
}

export async function migrateStore(input: {
  storeRoot: string;
  targetVersion: number;
  readerVersion: number;
  registry: SchemaRegistry;
  now?: () => Date;
  faultInjector?: (point: MigrationFaultPoint) => void | Promise<void>;
}): Promise<Readonly<{ activeStorePath: string; previousStorePath: string; report: unknown }>> {
  const now = input.now ?? (() => new Date());
  const pointerPath = path.join(input.storeRoot, 'active-store.json');
  const pointer = JSON.parse(await readFile(pointerPath, 'utf8')) as ActiveStorePointer;
  assertSafeRelative(pointer.relativePath);
  const activeStorePath = path.resolve(input.storeRoot, pointer.relativePath);
  if (!activeStorePath.startsWith(`${path.resolve(input.storeRoot)}${path.sep}`)) {
    throw new Error('active_store_pointer_invalid');
  }
  const lease = await acquireStoreMaintenanceLease(activeStorePath, 'maintenance-migration');
  try {
    const manifestPath = path.join(activeStorePath, 'store.json');
    let manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
    const fromVersion = manifest.formatVersion;
    if (!Number.isInteger(fromVersion)) throw new Error('store_manifest_invalid');
    const plan = createMigrationPlan(
      input.registry,
      fromVersion as number,
      input.targetVersion,
      input.readerVersion,
    );
    const candidatePath = path.join(
      path.dirname(activeStorePath),
      `store-v${input.targetVersion}-${randomUUID()}`,
    );
    const journalDirectory = path.join(input.storeRoot, 'maintenance');
    const journalPath = path.join(journalDirectory, 'migration-journal.json');
    await mkdir(journalDirectory, { recursive: true });
    await writeFile(
      journalPath,
      `${JSON.stringify({ state: 'copying', activeStorePath: pointer.relativePath, candidatePath })}\n`,
      'utf8',
    );
    let switched = false;
    try {
      await cp(activeStorePath, candidatePath, { recursive: true, errorOnExist: true });
      await rm(path.join(candidatePath, 'locks'), { recursive: true, force: true });
      await input.faultInjector?.('candidate_copied');
      for (const migration of plan) {
        const preconditions = migration.preconditions(manifest);
        if (blocking(preconditions)) throw new Error('migration_precondition_failed');
        manifest = migration.transform(manifest) as Record<string, unknown>;
        const postconditions = migration.postconditions(manifest);
        if (blocking(postconditions)) throw new Error('migration_postcondition_failed');
        if (manifest.formatVersion !== migration.toVersion) {
          throw new Error('migration_version_not_advanced');
        }
      }
      await writeFile(
        path.join(candidatePath, 'store.json'),
        `${JSON.stringify(manifest)}\n`,
        'utf8',
      );
      await rm(path.join(candidatePath, 'read-models'), { recursive: true, force: true });
      await rm(path.join(candidatePath, 'indexes'), { recursive: true, force: true });
      await mkdir(path.join(candidatePath, 'read-models'), { recursive: true });
      await mkdir(path.join(candidatePath, 'indexes'), { recursive: true });
      await writeFile(
        path.join(candidatePath, '.migration-receipts.json'),
        `${JSON.stringify(await fileReceipts(candidatePath))}\n`,
        'utf8',
      );
      await input.faultInjector?.('transformed');
      const report = await verifyStore(candidatePath, { supportedVersions: [input.targetVersion] });
      if (report.status !== 'verified') throw new Error('migration_candidate_invalid');
      await input.faultInjector?.('verified');
      const relativeCandidate = path.relative(input.storeRoot, candidatePath).replaceAll('\\', '/');
      const temporaryPointer = `${pointerPath}.${randomUUID()}.tmp`;
      await writeFile(
        temporaryPointer,
        `${JSON.stringify({
          relativePath: relativeCandidate,
          generation: pointer.generation + 1,
          updatedAt: now().toISOString(),
        })}\n`,
        'utf8',
      );
      await rename(temporaryPointer, pointerPath);
      switched = true;
      await writeFile(
        journalPath,
        `${JSON.stringify({ state: 'complete', previousStorePath: pointer.relativePath, activeStorePath: relativeCandidate })}\n`,
        'utf8',
      );
      await input.faultInjector?.('pointer_switched');
      return { activeStorePath: candidatePath, previousStorePath: activeStorePath, report };
    } catch (error) {
      if (!switched) await rm(candidatePath, { recursive: true, force: true });
      throw error;
    }
  } finally {
    await lease.release();
  }
}
