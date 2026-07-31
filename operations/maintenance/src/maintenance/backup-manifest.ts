export type BackupObject = Readonly<{
  relativePath: string;
  size: number;
  checksum: string;
}>;

export type BackupManifest = Readonly<{
  backupId: string;
  storeId: string;
  schemaVersion: number;
  createdAt: string;
  sourceCheckpoint: Readonly<{
    transactionId: string;
    sequence: number;
  }>;
  objects: readonly BackupObject[];
  buildId: string;
  status: 'complete';
  verificationStatus: 'verified';
  trigger: 'automatic' | 'manual' | 'pre-migration' | 'pre-upgrade' | 'diagnostic';
}>;

export function parseBackupManifest(value: unknown): BackupManifest {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('backup_manifest_invalid');
  }
  const record = value as Record<string, unknown>;
  const checkpoint = record.sourceCheckpoint as Record<string, unknown> | undefined;
  if (
    typeof record.backupId !== 'string' ||
    typeof record.storeId !== 'string' ||
    !Number.isInteger(record.schemaVersion) ||
    typeof record.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(record.createdAt)) ||
    record.sourceCheckpoint === null ||
    typeof record.sourceCheckpoint !== 'object' ||
    typeof checkpoint?.transactionId !== 'string' ||
    !Number.isInteger(checkpoint.sequence) ||
    !Array.isArray(record.objects) ||
    typeof record.buildId !== 'string' ||
    record.status !== 'complete' ||
    record.verificationStatus !== 'verified' ||
    !['automatic', 'manual', 'pre-migration', 'pre-upgrade', 'diagnostic'].includes(
      record.trigger as string,
    )
  ) {
    throw new Error('backup_manifest_invalid');
  }
  const relativePaths = new Set<string>();
  for (const item of record.objects) {
    const relativePath = String((item as Record<string, unknown>).relativePath);
    if (
      item === null ||
      typeof item !== 'object' ||
      typeof (item as Record<string, unknown>).relativePath !== 'string' ||
      !Number.isInteger((item as Record<string, unknown>).size) ||
      typeof (item as Record<string, unknown>).checksum !== 'string' ||
      !/^[a-f0-9]{64}$/.test(String((item as Record<string, unknown>).checksum))
    ) {
      throw new Error('backup_manifest_invalid');
    }
    const normalized = relativePath.replaceAll('\\', '/');
    if (
      relativePath !== normalized ||
      normalized === '' ||
      normalized.startsWith('/') ||
      normalized
        .split('/')
        .some((segment) => segment === '' || segment === '.' || segment === '..') ||
      relativePaths.has(normalized)
    ) {
      throw new Error('backup_manifest_invalid');
    }
    relativePaths.add(normalized);
  }
  return record as BackupManifest;
}
