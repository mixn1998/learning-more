import { createHash, randomUUID } from 'node:crypto';
import {
  constants,
  copyFile,
  link,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  statfs,
  type FileHandle,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

import { parseBackupManifest, type BackupManifest, type BackupObject } from './backup-manifest.js';
import { acquireStoreMaintenanceLease } from './store-maintenance-lease.js';
import { verifyStore } from './verify-store.js';

export type BackupFaultPoint = 'manifest_partial' | 'object_copied' | 'before_complete';

const excludedTopLevel = new Set([
  'backups',
  'locks',
  'transactions',
  'work',
  'read-models',
  'indexes',
  'quarantine',
  'runtime',
  'logs',
  'secrets',
]);

async function sourceFiles(root: string, directory = root): Promise<string[]> {
  const output: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    const relative = path.relative(root, absolute).replaceAll('\\', '/');
    if (relative.split('/').length === 1 && excludedTopLevel.has(entry.name)) continue;
    if (entry.isSymbolicLink()) throw new Error('backup_symlink_unsupported');
    if (entry.isDirectory()) output.push(...(await sourceFiles(root, absolute)));
    else output.push(relative);
  }
  return output.sort();
}

async function sha256(filePath: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(filePath))
    .digest('hex');
}

async function sha256Prefix(filePath: string, size: number): Promise<string> {
  const hash = createHash('sha256');
  const handle = await open(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  let position = 0;
  try {
    while (position < size) {
      const length = Math.min(buffer.length, size - position);
      const { bytesRead } = await handle.read(buffer, 0, length, position);
      if (bytesRead === 0) throw new Error('backup_snapshot_truncated');
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
  } finally {
    await handle.close();
  }
  return hash.digest('hex');
}

async function copyPrefix(source: string, target: string, size: number): Promise<void> {
  const input = await open(source, 'r');
  let output: FileHandle | undefined;
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  let position = 0;
  try {
    output = await open(target, 'wx');
    while (position < size) {
      const length = Math.min(buffer.length, size - position);
      const { bytesRead } = await input.read(buffer, 0, length, position);
      if (bytesRead === 0) throw new Error('backup_snapshot_truncated');
      await output.write(buffer, 0, bytesRead, position);
      position += bytesRead;
    }
    await output.sync();
  } finally {
    await Promise.all([input.close(), output?.close()]);
  }
}

function objectPath(backupRoot: string, checksum: string): string {
  return path.join(backupRoot, 'objects', 'sha256', checksum.slice(0, 2), checksum);
}

export async function verifyBackup(
  backupRoot: string,
  manifestOrId: string | BackupManifest,
): Promise<Readonly<{ status: 'verified' | 'invalid'; issues: readonly string[] }>> {
  let manifest: BackupManifest;
  try {
    manifest =
      typeof manifestOrId === 'string'
        ? parseBackupManifest(
            JSON.parse(
              await readFile(path.join(backupRoot, 'manifests', `${manifestOrId}.json`), 'utf8'),
            ) as unknown,
          )
        : parseBackupManifest(manifestOrId);
  } catch {
    return { status: 'invalid', issues: ['backup_manifest_invalid'] };
  }
  const issues: string[] = [];
  for (const object of manifest.objects) {
    const filePath = objectPath(backupRoot, object.checksum);
    try {
      const metadata = await stat(filePath);
      if (metadata.size !== object.size || (await sha256(filePath)) !== object.checksum) {
        issues.push(`backup_object_invalid:${object.relativePath}`);
      }
    } catch {
      issues.push(`backup_object_missing:${object.relativePath}`);
    }
  }
  return { status: issues.length === 0 ? 'verified' : 'invalid', issues };
}

export async function createBackup(input: {
  storePath: string;
  backupRoot: string;
  buildId: string;
  trigger: BackupManifest['trigger'];
  now?: () => Date;
  faultInjector?: (point: BackupFaultPoint) => void | Promise<void>;
}): Promise<Readonly<{ manifest: BackupManifest; copiedObjects: number; reusedObjects: number }>> {
  if (input.trigger === 'automatic') {
    await mkdir(input.backupRoot, { recursive: true });
    const disk = await statfs(input.backupRoot);
    if (disk.blocks > 0 && disk.bavail / disk.blocks < 0.1)
      throw new Error('backup_low_disk_space');
  }
  const backupId = `backup_${randomUUID()}`;
  const snapshotDirectory = path.join(input.storePath, 'work', 'backup-snapshots', backupId);
  const partialDirectory = path.join(input.backupRoot, 'partial');
  const manifestDirectory = path.join(input.backupRoot, 'manifests');
  const partialPath = path.join(partialDirectory, `${backupId}.json`);
  let storeManifest: Record<string, unknown> = {};
  const files: Array<{ relativePath: string; size: number }> = [];
  let snapshotReady = false;
  const lease = await acquireStoreMaintenanceLease(input.storePath, 'maintenance-backup');
  try {
    const verification = await verifyStore(input.storePath);
    if (verification.status !== 'verified' && input.trigger !== 'diagnostic')
      throw new Error('backup_source_invalid');
    storeManifest = await readFile(path.join(input.storePath, 'store.json'), 'utf8')
      .then((content) => JSON.parse(content) as Record<string, unknown>)
      .catch(() => ({}) as Record<string, unknown>);
    const relativePaths = await sourceFiles(input.storePath);
    for (const relativePath of relativePaths) {
      const source = path.join(input.storePath, relativePath);
      const snapshot = path.join(snapshotDirectory, relativePath);
      await mkdir(path.dirname(snapshot), { recursive: true });
      try {
        await link(source, snapshot);
      } catch {
        await copyFile(source, snapshot, constants.COPYFILE_EXCL);
      }
      files.push({ relativePath, size: (await stat(snapshot)).size });
    }
    snapshotReady = true;
  } finally {
    await lease.release();
    if (!snapshotReady) await rm(snapshotDirectory, { recursive: true, force: true });
  }

  let copiedObjects = 0;
  let reusedObjects = 0;
  try {
    await mkdir(partialDirectory, { recursive: true });
    await mkdir(manifestDirectory, { recursive: true });
    await writeFile(
      partialPath,
      `${JSON.stringify({
        backupId,
        status: 'creating',
        files: files.map((file) => file.relativePath),
      })}\n`,
      'utf8',
    );
    await input.faultInjector?.('manifest_partial');
    const objects: BackupObject[] = [];
    for (const file of files) {
      const { relativePath, size } = file;
      const source = path.join(snapshotDirectory, relativePath);
      const checksum = await sha256Prefix(source, size);
      const target = objectPath(input.backupRoot, checksum);
      try {
        const existing = await stat(target);
        if (existing.size !== size || (await sha256(target)) !== checksum) {
          throw new Error('backup_existing_object_invalid');
        }
        reusedObjects += 1;
      } catch (error) {
        if ((error as Error).message === 'backup_existing_object_invalid') throw error;
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        await mkdir(path.dirname(target), { recursive: true });
        const temporary = `${target}.${randomUUID()}.tmp`;
        try {
          await copyPrefix(source, temporary, size);
          if ((await stat(temporary)).size !== size || (await sha256(temporary)) !== checksum) {
            throw new Error('backup_copied_object_invalid');
          }
          await rename(temporary, target);
          copiedObjects += 1;
        } finally {
          await rm(temporary, { force: true });
        }
      }
      objects.push({ relativePath, size, checksum });
      await input.faultInjector?.('object_copied');
    }
    const manifest: BackupManifest = {
      backupId,
      storeId: typeof storeManifest.storeId === 'string' ? storeManifest.storeId : 'unknown',
      schemaVersion: Number.isInteger(storeManifest.formatVersion)
        ? Number(storeManifest.formatVersion)
        : 0,
      createdAt: (input.now ?? (() => new Date()))().toISOString(),
      sourceCheckpoint: {
        transactionId: String(storeManifest.lastCommittedTransactionId ?? ''),
        sequence: Number(storeManifest.lastCommittedSequence ?? 0),
      },
      objects,
      buildId: input.buildId,
      status: 'complete',
      verificationStatus: 'verified',
      trigger: input.trigger,
    };
    const checked = await verifyBackup(input.backupRoot, manifest);
    if (checked.status !== 'verified') throw new Error('backup_verification_failed');
    await input.faultInjector?.('before_complete');
    const temporary = path.join(manifestDirectory, `${backupId}.${randomUUID()}.tmp`);
    await writeFile(temporary, `${JSON.stringify(manifest)}\n`, 'utf8');
    await rename(temporary, path.join(manifestDirectory, `${backupId}.json`));
    await rm(partialPath, { force: true });
    return { manifest, copiedObjects, reusedObjects };
  } finally {
    await rm(snapshotDirectory, { recursive: true, force: true });
  }
}
