import { createHash, randomUUID } from 'node:crypto';
import { copyFile, lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { doctorStore, type DoctorReport } from './doctor.js';
import { acquireStoreMaintenanceLease } from './store-maintenance-lease.js';

function safeRelative(relativePath: string): string {
  const normalized = relativePath.replaceAll('\\', '/');
  if (
    normalized === '' ||
    path.posix.isAbsolute(normalized) ||
    normalized.split('/').some((segment) => segment === '..') ||
    normalized.startsWith('quarantine/')
  ) {
    throw new Error('quarantine_path_invalid');
  }
  return normalized;
}

async function existsFile(filePath: string): Promise<boolean> {
  try {
    const metadata = await lstat(filePath);
    if (metadata.isSymbolicLink()) throw new Error('quarantine_symlink_unsupported');
    return metadata.isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function stamp(date: Date): string {
  return date.toISOString().replaceAll(/[-:.]/g, '');
}

export async function quarantineIssues(input: {
  storePath: string;
  report: DoctorReport;
  now?: () => Date;
}): Promise<Readonly<{ quarantinePath: string; reportPath: string }>> {
  const now = (input.now ?? (() => new Date()))();
  const issueChecksum = createHash('sha256')
    .update(JSON.stringify(input.report.issues))
    .digest('hex')
    .slice(0, 12);
  const quarantinePath = path.join(
    input.storePath,
    'quarantine',
    `${stamp(now)}_${issueChecksum}_${randomUUID()}`,
  );
  const candidates = new Set<string>();
  for (const issue of input.report.issues) {
    if (issue.path === undefined || issue.path === '.') continue;
    const relativePath = safeRelative(issue.path);
    candidates.add(relativePath);
    const parsed = path.posix.parse(relativePath);
    candidates.add(path.posix.join(parsed.dir, `${parsed.name}.metadata.json`));
    if (relativePath.startsWith('events/segments/')) candidates.add('events/event-log.json');
  }

  const files: Array<{ relativePath: string; size: number; checksum: string }> = [];
  for (const relativePath of [...candidates].sort()) {
    const source = path.join(input.storePath, ...relativePath.split('/'));
    if (!(await existsFile(source))) continue;
    const content = await readFile(source);
    const destination = path.join(quarantinePath, 'files', ...relativePath.split('/'));
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(source, destination);
    files.push({
      relativePath,
      size: content.byteLength,
      checksum: `sha256:${createHash('sha256').update(content).digest('hex')}`,
    });
  }
  await mkdir(quarantinePath, { recursive: true });
  const reportPath = path.join(quarantinePath, 'report.json');
  await writeFile(
    reportPath,
    `${JSON.stringify({
      schemaVersion: 1,
      createdAt: now.toISOString(),
      classification: input.report.classification,
      actions: input.report.actions,
      issues: input.report.issues,
      files,
    })}\n`,
    'utf8',
  );
  return { quarantinePath, reportPath };
}

export async function repairDerivedIssues(input: {
  storePath: string;
  report: DoctorReport;
  now?: () => Date;
}): Promise<Readonly<{ quarantinePath: string; report: DoctorReport }>> {
  if (input.report.classification !== 'repairable-derived') {
    throw new Error('doctor_repair_not_allowed');
  }
  const lease = await acquireStoreMaintenanceLease(input.storePath, 'maintenance-doctor-repair');
  try {
    const quarantine = await quarantineIssues(input);
    const resetDirectories = new Set<string>();
    for (const issue of input.report.issues) {
      const relativePath = issue.path?.replaceAll('\\', '/') ?? '';
      if (relativePath.startsWith('read-models/')) resetDirectories.add('read-models');
      if (relativePath.startsWith('indexes/')) resetDirectories.add('indexes');
      if (relativePath.startsWith('work/')) resetDirectories.add('work');
      if (
        issue.code === 'outbox_pending_receipt_overlap' &&
        relativePath.startsWith('outbox/receipts/')
      ) {
        await rm(
          path.join(input.storePath, 'outbox', 'pending', path.posix.basename(relativePath)),
          { force: true },
        );
      }
    }
    for (const directory of resetDirectories) {
      const absolute = path.join(input.storePath, directory);
      await rm(absolute, { recursive: true, force: true });
      await mkdir(absolute, { recursive: true });
    }
    const report = await doctorStore(input.storePath);
    if (report.classification !== 'healthy') throw new Error('doctor_repair_incomplete');
    return { quarantinePath: quarantine.quarantinePath, report };
  } finally {
    await lease.release();
  }
}
