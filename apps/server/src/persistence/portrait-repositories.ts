import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import type {
  PortraitCurrentCursor,
  PortraitInputManifest,
  PortraitTaskReceipt,
  PortraitVersion,
} from '../modules/learning-portrait/interface.js';
import { PortraitInputManifestSchema } from '../modules/learning-portrait/implementation/portrait-input-manifest.js';
import type { PortraitRepository } from '../modules/learning-portrait/ports/portrait-repository.js';
import { DataRoot, assertSafePathSegment } from './data-root.js';
import { checksumJson, decodeAggregateDocument } from './json-codec.js';
import { RepositoryVersionConflictError } from './repository-errors.js';

const ClaimSchema = z.strictObject({
  claimId: z.string().min(1),
  markdown: z.string().min(1),
  evidenceIds: z.array(z.string().min(1)),
  confidence: z.number().min(0).max(1),
  limitations: z.array(z.string().min(1)),
  counterEvidenceChecked: z.literal(true),
});

const PortraitVersionSchema = z.strictObject({
  versionId: z.string().min(1),
  manifestId: z.string().min(1),
  state: z.enum(['preparing', 'generating', 'failed', 'completed']),
  generationTaskId: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  summary: z.string().min(1).optional(),
  claims: z.array(ClaimSchema),
  errorCode: z.string().min(1).optional(),
  draftArtifactRef: z.string().min(1).optional(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  completedAt: z.iso.datetime({ offset: true }).optional(),
  resourceVersion: z.number().int().nonnegative(),
});

const CursorSchema = z.strictObject({
  currentVersionId: z.string().min(1),
  updatedAt: z.iso.datetime({ offset: true }),
  resourceVersion: z.number().int().nonnegative(),
});

const ReceiptSchema = z.strictObject({
  idempotencyKey: z.string().min(1),
  versionId: z.string().min(1),
  manifestId: z.string().min(1),
  createdAt: z.iso.datetime({ offset: true }),
});

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function entityPath(kind: 'manifests' | 'versions', id: string): string {
  assertSafePathSegment(id);
  const hash = digest(id);
  return `portraits/${kind}/${hash.slice(0, 2)}/${id}.json`;
}

function receiptPath(idempotencyKey: string): string {
  const hash = digest(idempotencyKey);
  return `portraits/receipts/${hash.slice(0, 2)}/${hash}.json`;
}

function document(
  entityType: string,
  entityId: string,
  data: PortraitInputManifest | PortraitVersion | PortraitCurrentCursor | PortraitTaskReceipt,
) {
  const timestamp = 'updatedAt' in data ? data.updatedAt : data.createdAt;
  const resourceVersion = 'resourceVersion' in data ? data.resourceVersion : 1;
  return {
    schema: `learning-more/${entityType}`,
    schemaVersion: 1,
    entityType,
    entityId,
    resourceVersion,
    createdAt: timestamp,
    updatedAt: timestamp,
    contentSha256: checksumJson(data),
    data,
  };
}

async function listIds(root: string): Promise<string[]> {
  const ids: string[] = [];
  for (const shard of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!shard.isDirectory()) continue;
    for (const file of await readdir(path.join(root, shard.name), { withFileTypes: true })) {
      if (file.isFile() && file.name.endsWith('.json')) ids.push(file.name.slice(0, -5));
    }
  }
  return ids.sort();
}

async function readOptional<T>(filePath: string, schema: z.ZodType<T>): Promise<T | undefined> {
  try {
    return decodeAggregateDocument(await readFile(filePath, 'utf8'), schema).data;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

export function createLocalFilePortraitRepository(dataRoot: DataRoot): PortraitRepository {
  const manifestsRoot = path.join(dataRoot.absolutePath, 'portraits', 'manifests');
  const versionsRoot = path.join(dataRoot.absolutePath, 'portraits', 'versions');
  const repository: PortraitRepository = {
    getManifest: (id) =>
      readOptional(
        path.join(dataRoot.absolutePath, entityPath('manifests', id)),
        PortraitInputManifestSchema,
      ) as Promise<PortraitInputManifest | undefined>,
    async saveManifest(tx, manifest) {
      const existing = await repository.getManifest(manifest.manifestId);
      if (existing !== undefined) {
        if (JSON.stringify(existing) !== JSON.stringify(manifest)) {
          throw new Error('PORTRAIT_MANIFEST_IMMUTABLE');
        }
        return;
      }
      await tx.stageJson(
        entityPath('manifests', manifest.manifestId),
        document('portrait-manifest', manifest.manifestId, manifest),
      );
    },
    async *listManifests() {
      for (const id of await listIds(manifestsRoot)) {
        const manifest = await repository.getManifest(id);
        if (manifest !== undefined) yield manifest;
      }
    },
    getVersion: (id) =>
      readOptional(
        path.join(dataRoot.absolutePath, entityPath('versions', id)),
        PortraitVersionSchema,
      ) as Promise<PortraitVersion | undefined>,
    async saveVersion(tx, version, expectedVersion) {
      const existing = await repository.getVersion(version.versionId);
      const currentVersion = existing?.resourceVersion ?? 0;
      if (existing?.state === 'completed') throw new Error('PORTRAIT_VERSION_IMMUTABLE');
      if (currentVersion !== expectedVersion || version.resourceVersion !== expectedVersion) {
        throw new RepositoryVersionConflictError(currentVersion);
      }
      const stored = { ...version, resourceVersion: expectedVersion + 1 };
      await tx.stageJson(
        entityPath('versions', version.versionId),
        document('portrait-version', version.versionId, stored),
      );
    },
    async *listVersions() {
      for (const id of await listIds(versionsRoot)) {
        const version = await repository.getVersion(id);
        if (version !== undefined) yield version;
      }
    },
    getCurrent: () =>
      readOptional(
        path.join(dataRoot.absolutePath, 'portraits', 'current.json'),
        CursorSchema,
      ) as Promise<PortraitCurrentCursor | undefined>,
    async saveCurrent(tx, cursor, expectedVersion) {
      const currentVersion = (await repository.getCurrent())?.resourceVersion ?? 0;
      if (currentVersion !== expectedVersion || cursor.resourceVersion !== expectedVersion) {
        throw new RepositoryVersionConflictError(currentVersion);
      }
      const stored = { ...cursor, resourceVersion: expectedVersion + 1 };
      await tx.stageJson('portraits/current.json', document('portrait-current', 'current', stored));
    },
    getReceipt: (idempotencyKey) =>
      readOptional(
        path.join(dataRoot.absolutePath, receiptPath(idempotencyKey)),
        ReceiptSchema,
      ) as Promise<PortraitTaskReceipt | undefined>,
    async saveReceipt(tx, receipt) {
      const existing = await repository.getReceipt(receipt.idempotencyKey);
      if (existing !== undefined) {
        if (JSON.stringify(existing) !== JSON.stringify(receipt)) {
          throw new Error('PORTRAIT_RECEIPT_COLLISION');
        }
        return;
      }
      await tx.stageJson(
        receiptPath(receipt.idempotencyKey),
        document('portrait-receipt', digest(receipt.idempotencyKey), receipt),
      );
    },
  };
  return repository;
}
