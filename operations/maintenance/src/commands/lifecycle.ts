import path from 'node:path';

import { createBackup } from '../maintenance/backup.js';
import {
  applyBackupRetention,
  readBackupManifests,
  shouldCreateAutomaticBackup,
} from '../maintenance/retention.js';

export async function lifecycleCommand(arguments_: readonly string[]): Promise<number> {
  const positional = arguments_.filter((argument) => !argument.startsWith('--'));
  const storePath = positional[0];
  const backupRoot = positional[1];
  if (storePath === undefined) throw new Error('lifecycle_store_path_required');
  if (backupRoot === undefined) throw new Error('lifecycle_backup_root_required');
  const resolvedStore = path.resolve(storePath);
  const resolvedBackupRoot = path.resolve(backupRoot);
  const now = new Date();
  let createdBackupId: string | undefined;
  if (shouldCreateAutomaticBackup(await readBackupManifests(resolvedBackupRoot), now)) {
    const result = await createBackup({
      storePath: resolvedStore,
      backupRoot: resolvedBackupRoot,
      buildId: process.env.LEARNING_MORE_BUILD_ID ?? 'development',
      trigger: 'automatic',
      now: () => now,
    });
    createdBackupId = result.manifest.backupId;
  }
  const retention = await applyBackupRetention(resolvedBackupRoot, now);
  process.stdout.write(
    `${JSON.stringify({
      status: 'complete',
      createdBackupId,
      retained: retention.keep.length,
      removed: retention.remove.length,
    })}\n`,
  );
  return 0;
}
