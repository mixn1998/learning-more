import { RepositoryVersionConflictError } from '../../../persistence/repository-errors.js';
import type { TransactionContext } from '../../../persistence/unit-of-work.js';
import type {
  PortraitCurrentCursor,
  PortraitInputManifest,
  PortraitTaskReceipt,
  PortraitVersion,
} from '../interface.js';

export interface PortraitRepository {
  getManifest(manifestId: string): Promise<PortraitInputManifest | undefined>;
  saveManifest(tx: TransactionContext, manifest: PortraitInputManifest): Promise<void>;
  listManifests(): AsyncIterable<PortraitInputManifest>;
  getVersion(versionId: string): Promise<PortraitVersion | undefined>;
  saveVersion(
    tx: TransactionContext,
    version: PortraitVersion,
    expectedVersion: number,
  ): Promise<void>;
  listVersions(): AsyncIterable<PortraitVersion>;
  getCurrent(): Promise<PortraitCurrentCursor | undefined>;
  saveCurrent(
    tx: TransactionContext,
    cursor: PortraitCurrentCursor,
    expectedVersion: number,
  ): Promise<void>;
  getReceipt(idempotencyKey: string): Promise<PortraitTaskReceipt | undefined>;
  saveReceipt(tx: TransactionContext, receipt: PortraitTaskReceipt): Promise<void>;
}

export function createInMemoryPortraitRepository(): PortraitRepository {
  const manifests = new Map<string, PortraitInputManifest>();
  const versions = new Map<string, PortraitVersion>();
  const receipts = new Map<string, PortraitTaskReceipt>();
  let current: PortraitCurrentCursor | undefined;
  return {
    getManifest: async (id) => structuredClone(manifests.get(id)),
    async saveManifest(_tx, manifest) {
      const existing = manifests.get(manifest.manifestId);
      if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(manifest)) {
        throw new Error('PORTRAIT_MANIFEST_IMMUTABLE');
      }
      manifests.set(manifest.manifestId, structuredClone(manifest));
    },
    async *listManifests() {
      for (const id of [...manifests.keys()].sort()) yield structuredClone(manifests.get(id)!);
    },
    getVersion: async (id) => structuredClone(versions.get(id)),
    async saveVersion(_tx, version, expectedVersion) {
      const existing = versions.get(version.versionId);
      const currentVersion = existing?.resourceVersion ?? 0;
      if (existing?.state === 'completed') {
        if (JSON.stringify(existing) === JSON.stringify(version)) return;
        throw new Error('PORTRAIT_VERSION_IMMUTABLE');
      }
      if (currentVersion !== expectedVersion || version.resourceVersion !== expectedVersion) {
        throw new RepositoryVersionConflictError(currentVersion);
      }
      versions.set(
        version.versionId,
        structuredClone({ ...version, resourceVersion: expectedVersion + 1 }),
      );
    },
    async *listVersions() {
      for (const id of [...versions.keys()].sort()) yield structuredClone(versions.get(id)!);
    },
    getCurrent: async () => structuredClone(current),
    async saveCurrent(_tx, cursor, expectedVersion) {
      const currentVersion = current?.resourceVersion ?? 0;
      if (currentVersion !== expectedVersion || cursor.resourceVersion !== expectedVersion) {
        throw new RepositoryVersionConflictError(currentVersion);
      }
      current = structuredClone({ ...cursor, resourceVersion: expectedVersion + 1 });
    },
    getReceipt: async (idempotencyKey) => structuredClone(receipts.get(idempotencyKey)),
    async saveReceipt(_tx, receipt) {
      const existing = receipts.get(receipt.idempotencyKey);
      if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(receipt)) {
        throw new Error('PORTRAIT_RECEIPT_COLLISION');
      }
      receipts.set(receipt.idempotencyKey, structuredClone(receipt));
    },
  };
}
