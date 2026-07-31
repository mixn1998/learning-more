import path from 'node:path';

import { createBackup, verifyBackup } from '../maintenance/backup.js';
import { applyBackupRetention } from '../maintenance/retention.js';

export async function backupCommand(arguments_: readonly string[]): Promise<number> {
  const positional = arguments_.filter((argument) => !argument.startsWith('--'));
  const storePath = positional[0];
  const backupRoot = positional[1];
  if (storePath === undefined) throw new Error('backup_store_path_required');
  if (backupRoot === undefined) throw new Error('backup_root_required');
  const result = await createBackup({
    storePath: path.resolve(storePath),
    backupRoot: path.resolve(backupRoot),
    buildId: process.env.LEARNING_MORE_BUILD_ID ?? 'development',
    trigger: 'manual',
  });
  const verification = arguments_.includes('--verify')
    ? await verifyBackup(path.resolve(backupRoot), result.manifest)
    : { status: 'verified' as const, issues: [] };
  const retention = await applyBackupRetention(path.resolve(backupRoot));
  const report = {
    status: verification.status,
    backupId: result.manifest.backupId,
    copiedObjects: result.copiedObjects,
    reusedObjects: result.reusedObjects,
    issues: verification.issues,
    retained: retention.keep.length,
    removed: retention.remove.length,
  };
  process.stdout.write(`${JSON.stringify(report)}\n`);
  return verification.status === 'verified' ? 0 : 1;
}
