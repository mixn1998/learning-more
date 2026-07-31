import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { parseBackupManifest, type BackupManifest } from './backup-manifest.js';
import { verifyBackup } from './backup.js';
import { createMigrationPlan } from './migration-plan.js';
import type { SchemaRegistry, VerificationIssue } from './schema-registry.js';
import { acquireStoreMaintenanceLease } from './store-maintenance-lease.js';
import { verifyStore } from './verify-store.js';

type ActiveStorePointer = Readonly<{
  relativePath: string;
  generation: number;
  updatedAt: string;
}>;

type RestoreJournal = Readonly<{
  schemaVersion: 1;
  state: 'pending' | 'complete' | 'rolled-back';
  backupId: string;
  previousRelativePath: string;
  candidateRelativePath: string;
  generation: number;
  createdAt: string;
  recovered?: boolean;
}>;

export type RestoreFaultPoint =
  'candidate_restored' | 'candidate_verified' | 'before_pointer_switch' | 'after_pointer_switch';

function safeRelative(value: string, code = 'active_store_pointer_invalid'): string {
  const normalized = value.replaceAll('\\', '/');
  if (
    normalized !== value ||
    normalized === '' ||
    normalized.startsWith('/') ||
    normalized.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new Error(code);
  }
  return normalized;
}

function resolveWithin(root: string, relativePath: string, code: string): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(root, ...safeRelative(relativePath, code).split('/'));
  if (!resolved.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error(code);
  return resolved;
}

async function writeAtomic(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`, 'utf8');
  await rename(temporary, filePath);
}

async function readPointer(pointerPath: string): Promise<ActiveStorePointer> {
  const pointer = JSON.parse(await readFile(pointerPath, 'utf8')) as ActiveStorePointer;
  safeRelative(pointer.relativePath);
  if (!Number.isInteger(pointer.generation) || pointer.generation < 0) {
    throw new Error('active_store_pointer_invalid');
  }
  return pointer;
}

async function verifyKnownVersion(storePath: string) {
  const manifest = JSON.parse(await readFile(path.join(storePath, 'store.json'), 'utf8')) as {
    formatVersion?: unknown;
  };
  if (!Number.isInteger(manifest.formatVersion)) throw new Error('store_manifest_invalid');
  return verifyStore(storePath, { supportedVersions: [Number(manifest.formatVersion)] });
}

async function recoverPendingJournal(input: {
  storeRoot: string;
  pointer: ActiveStorePointer;
  journalPath: string;
}): Promise<void> {
  let journal: RestoreJournal;
  try {
    journal = JSON.parse(await readFile(input.journalPath, 'utf8')) as RestoreJournal;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  if (journal.state !== 'pending') return;
  if (input.pointer.relativePath === journal.candidateRelativePath) {
    const candidate = resolveWithin(
      input.storeRoot,
      journal.candidateRelativePath,
      'restore_journal_invalid',
    );
    const verification = await verifyKnownVersion(candidate);
    if (verification.status !== 'verified') throw new Error('restore_journal_ambiguous');
    await writeAtomic(input.journalPath, { ...journal, state: 'complete', recovered: true });
    return;
  }
  if (input.pointer.relativePath === journal.previousRelativePath) {
    const candidate = resolveWithin(
      input.storeRoot,
      journal.candidateRelativePath,
      'restore_journal_invalid',
    );
    await rm(candidate, { recursive: true, force: true });
    await writeAtomic(input.journalPath, { ...journal, state: 'rolled-back', recovered: true });
    return;
  }
  throw new Error('restore_journal_ambiguous');
}

function blocking(issues: readonly VerificationIssue[]): boolean {
  return issues.some((issue) => issue.severity !== 'warning');
}

async function migrateCandidate(input: {
  candidatePath: string;
  targetVersion: number;
  readerVersion: number;
  registry: SchemaRegistry;
}): Promise<void> {
  const manifestPath = path.join(input.candidatePath, 'store.json');
  let manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
  if (!Number.isInteger(manifest.formatVersion)) throw new Error('store_manifest_invalid');
  const plan = createMigrationPlan(
    input.registry,
    Number(manifest.formatVersion),
    input.targetVersion,
    input.readerVersion,
  );
  for (const migration of plan) {
    if (blocking(migration.preconditions(manifest)))
      throw new Error('migration_precondition_failed');
    manifest = migration.transform(manifest) as Record<string, unknown>;
    if (blocking(migration.postconditions(manifest)))
      throw new Error('migration_postcondition_failed');
    if (manifest.formatVersion !== migration.toVersion)
      throw new Error('migration_version_not_advanced');
  }
  await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`, 'utf8');
}

function objectPath(backupRoot: string, checksum: string): string {
  return path.join(backupRoot, 'objects', 'sha256', checksum.slice(0, 2), checksum);
}

function safeBackupId(backupId: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(backupId)) throw new Error('restore_backup_id_invalid');
  return backupId;
}

async function readBackupManifest(backupRoot: string, backupId: string): Promise<BackupManifest> {
  safeBackupId(backupId);
  return parseBackupManifest(
    JSON.parse(
      await readFile(path.join(backupRoot, 'manifests', `${backupId}.json`), 'utf8'),
    ) as unknown,
  );
}

export async function restoreStore(input: {
  storeRoot: string;
  backupRoot: string;
  backupId: string;
  targetVersion: number;
  readerVersion: number;
  registry: SchemaRegistry;
  now?: () => Date;
  faultInjector?: (point: RestoreFaultPoint) => void | Promise<void>;
}): Promise<Readonly<{ activeStorePath: string; previousStorePath: string; report: unknown }>> {
  safeBackupId(input.backupId);
  const now = input.now ?? (() => new Date());
  const pointerPath = path.join(input.storeRoot, 'active-store.json');
  const journalPath = path.join(input.storeRoot, 'maintenance', 'restore-journal.json');
  const pointer = await readPointer(pointerPath);
  const previousStorePath = resolveWithin(
    input.storeRoot,
    pointer.relativePath,
    'active_store_pointer_invalid',
  );
  const lease = await acquireStoreMaintenanceLease(previousStorePath, 'maintenance-restore');
  let switched = false;
  let candidatePath = '';
  try {
    await recoverPendingJournal({ storeRoot: input.storeRoot, pointer, journalPath });
    const backupVerification = await verifyBackup(input.backupRoot, input.backupId);
    if (backupVerification.status !== 'verified') throw new Error('restore_backup_invalid');
    const manifest = await readBackupManifest(input.backupRoot, input.backupId);
    if (manifest.backupId !== input.backupId) throw new Error('restore_backup_invalid');
    candidatePath = path.join(input.storeRoot, 'stores', `restore-${randomUUID()}`);
    const candidateRelativePath = path
      .relative(input.storeRoot, candidatePath)
      .replaceAll('\\', '/');
    const journal: RestoreJournal = {
      schemaVersion: 1,
      state: 'pending',
      backupId: input.backupId,
      previousRelativePath: pointer.relativePath,
      candidateRelativePath,
      generation: pointer.generation + 1,
      createdAt: now().toISOString(),
    };
    await writeAtomic(journalPath, journal);
    for (const object of manifest.objects) {
      const destination = resolveWithin(
        candidatePath,
        object.relativePath,
        'restore_manifest_path_invalid',
      );
      await mkdir(path.dirname(destination), { recursive: true });
      await copyFile(objectPath(input.backupRoot, object.checksum), destination);
    }
    await input.faultInjector?.('candidate_restored');
    const restoredManifest = JSON.parse(
      await readFile(path.join(candidatePath, 'store.json'), 'utf8'),
    ) as Record<string, unknown>;
    if (
      restoredManifest.storeId !== manifest.storeId ||
      restoredManifest.formatVersion !== manifest.schemaVersion ||
      String(restoredManifest.lastCommittedTransactionId ?? '') !==
        manifest.sourceCheckpoint.transactionId ||
      Number(restoredManifest.lastCommittedSequence ?? 0) !== manifest.sourceCheckpoint.sequence
    ) {
      throw new Error('restore_checkpoint_mismatch');
    }
    await migrateCandidate({
      candidatePath,
      targetVersion: input.targetVersion,
      readerVersion: input.readerVersion,
      registry: input.registry,
    });
    await rm(path.join(candidatePath, 'read-models'), { recursive: true, force: true });
    await rm(path.join(candidatePath, 'indexes'), { recursive: true, force: true });
    await mkdir(path.join(candidatePath, 'read-models'), { recursive: true });
    await mkdir(path.join(candidatePath, 'indexes'), { recursive: true });
    const report = await verifyStore(candidatePath, {
      supportedVersions: [input.targetVersion],
    });
    if (report.status !== 'verified') throw new Error('restore_candidate_invalid');
    await input.faultInjector?.('candidate_verified');
    await input.faultInjector?.('before_pointer_switch');
    await writeAtomic(pointerPath, {
      relativePath: candidateRelativePath,
      generation: pointer.generation + 1,
      updatedAt: now().toISOString(),
    });
    switched = true;
    await input.faultInjector?.('after_pointer_switch');
    await writeAtomic(journalPath, { ...journal, state: 'complete' });
    return { activeStorePath: candidatePath, previousStorePath, report };
  } catch (error) {
    if (!switched && candidatePath !== '') {
      await rm(candidatePath, { recursive: true, force: true });
    }
    throw error;
  } finally {
    await lease.release();
  }
}
