import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import type {
  SemanticProfileCoreRecord,
  SemanticProfileCoreRepository,
  SemanticProfileSourceReceipt,
} from '../modules/global-user-profile/ports/semantic-profile-core-repository.js';
import { DataRoot } from './data-root.js';
import { checksumJson, decodeAggregateDocument } from './json-codec.js';
import { createStorePaths } from './paths.js';
import { RepositoryVersionConflictError } from './repository-errors.js';

const ModeSchema = z.strictObject({
  modeId: z.string().min(1),
  origin: z.enum(['observed_behavior', 'explicit_preference']),
  status: z.enum(['candidate', 'stable']),
  feature: z.string().trim().min(1),
  teachingImpact: z.string().trim().min(1),
  applicabilityBoundary: z.string().trim().min(1),
  supportingSessionCount: z.number().int().nonnegative(),
  representativeEvidenceIds: z.array(z.string().min(1)).max(3),
  representativeSourceRefs: z.array(z.string().min(1)).max(6),
  priority: z.number().int().min(1).max(5),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});

const CoreSchema = z.strictObject({
  coreId: z.literal('global_learning'),
  schemaVersion: z.literal(1),
  mergerVersion: z.string().min(1),
  sourceSnapshotHash: z.string().length(64),
  modes: z.array(ModeSchema).max(13),
  updatedAt: z.iso.datetime({ offset: true }),
  resourceVersion: z.number().int().nonnegative(),
});

const ReceiptSchema = z.strictObject({
  receiptId: z.string().min(1),
  sourceId: z.string().min(1),
  sourceSnapshotHash: z.string().length(64),
  sourceGroupId: z.string().min(1),
  appliedModeIds: z.array(z.string().min(1)),
  createdAt: z.iso.datetime({ offset: true }),
});

export function createInMemorySemanticProfileCoreRepository(): SemanticProfileCoreRepository {
  let core: SemanticProfileCoreRecord | undefined;
  const receipts = new Map<string, SemanticProfileSourceReceipt>();
  return {
    getCore: async () => (core === undefined ? undefined : structuredClone(core)),
    async saveCore(_tx, next, expectedVersion) {
      const currentVersion = core?.resourceVersion ?? 0;
      if (currentVersion !== expectedVersion || next.resourceVersion !== expectedVersion) {
        throw new RepositoryVersionConflictError(currentVersion);
      }
      core = structuredClone({ ...next, resourceVersion: expectedVersion + 1 });
    },
    getReceipt: async (id) => structuredClone(receipts.get(id)),
    async saveReceipt(_tx, receipt) {
      if (receipts.has(receipt.receiptId)) return;
      receipts.set(receipt.receiptId, structuredClone(receipt));
    },
  };
}

export function createLocalFileSemanticProfileCoreRepository(
  dataRoot: DataRoot,
): SemanticProfileCoreRepository {
  const paths = createStorePaths(dataRoot);
  const coreType = 'semantic-profile-cores';
  const receiptType = 'semantic-profile-core-receipts';

  async function read<T>(entityType: string, entityId: string, schema: z.ZodType<T>) {
    try {
      return decodeAggregateDocument(
        await readFile(paths.aggregate(entityType, entityId), 'utf8'),
        schema,
      ).data;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async function stage(
    tx: Parameters<SemanticProfileCoreRepository['saveCore']>[0],
    entityType: string,
    entityId: string,
    data: unknown,
    resourceVersion: number,
  ) {
    const timestamp = new Date().toISOString();
    const absolutePath = paths.aggregate(entityType, entityId);
    await tx.stageJson(path.relative(dataRoot.absolutePath, absolutePath).replaceAll('\\', '/'), {
      schema: `learning-more/${entityType}`,
      schemaVersion: 1,
      entityType,
      entityId,
      resourceVersion,
      createdAt: timestamp,
      updatedAt: timestamp,
      contentSha256: checksumJson(data),
      data,
    });
  }

  const repository: SemanticProfileCoreRepository = {
    async getCore() {
      return (await read(coreType, 'global_learning', CoreSchema)) as
        SemanticProfileCoreRecord | undefined;
    },
    async saveCore(tx, core, expectedVersion) {
      const currentVersion = (await repository.getCore())?.resourceVersion ?? 0;
      if (currentVersion !== expectedVersion || core.resourceVersion !== expectedVersion) {
        throw new RepositoryVersionConflictError(currentVersion);
      }
      const stored = CoreSchema.parse({ ...core, resourceVersion: expectedVersion + 1 });
      await stage(tx, coreType, core.coreId, stored, stored.resourceVersion);
    },
    async getReceipt(id) {
      return (await read(receiptType, id, ReceiptSchema)) as
        SemanticProfileSourceReceipt | undefined;
    },
    async saveReceipt(tx, receipt) {
      if ((await repository.getReceipt(receipt.receiptId)) !== undefined) return;
      const stored = ReceiptSchema.parse(receipt);
      await stage(tx, receiptType, receipt.receiptId, stored, 1);
    },
  };
  return repository;
}
