import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  TeachingCheckpointSnapshotSchema,
  TeachingObservationSchema,
  TeachingStateSnapshotSchema,
} from '@learning-more/contracts';
import { z } from 'zod';

import type {
  TeachingLedgerRecord,
  TeachingLedgerRepository,
} from '../modules/interactive-teaching/ports/teaching-ledger-repository.js';
import { DataRoot } from './data-root.js';
import { checksumJson, decodeAggregateDocument } from './json-codec.js';
import { createStorePaths } from './paths.js';
import { RepositoryVersionConflictError } from './repository-errors.js';

const TeachingLedgerRecordSchema = z.strictObject({
  courseId: z.string().min(1),
  lessonId: z.string().min(1),
  sessionId: z.string().min(1),
  observations: z.array(TeachingObservationSchema),
  checkpoints: z.array(TeachingCheckpointSnapshotSchema),
  state: TeachingStateSnapshotSchema,
  resourceVersion: z.number().int().nonnegative(),
});

export function createInMemoryTeachingLedgerRepository(): TeachingLedgerRepository {
  const records = new Map<string, TeachingLedgerRecord>();
  return {
    get: async (sessionId) => structuredClone(records.get(sessionId)),
    async save(_tx, record, expectedVersion) {
      const currentVersion = records.get(record.sessionId)?.resourceVersion ?? 0;
      if (currentVersion !== expectedVersion || record.resourceVersion !== expectedVersion) {
        throw new RepositoryVersionConflictError(currentVersion);
      }
      records.set(
        record.sessionId,
        structuredClone({ ...record, resourceVersion: expectedVersion + 1 }),
      );
    },
    async delete(_tx, sessionId, expectedVersion) {
      const currentVersion = records.get(sessionId)?.resourceVersion;
      if (currentVersion === undefined) return;
      if (currentVersion !== expectedVersion) {
        throw new RepositoryVersionConflictError(currentVersion);
      }
      records.delete(sessionId);
    },
    async *list(filter = {}) {
      for (const sessionId of [...records.keys()].sort()) {
        const record = records.get(sessionId)!;
        if (filter.courseId === undefined || record.courseId === filter.courseId) {
          yield structuredClone(record);
        }
      }
    },
  };
}

export function createLocalFileTeachingLedgerRepository(
  dataRoot: DataRoot,
): TeachingLedgerRepository {
  const paths = createStorePaths(dataRoot);
  const entityType = 'teaching-ledgers';
  const repository: TeachingLedgerRepository = {
    async get(sessionId) {
      try {
        return decodeAggregateDocument(
          await readFile(paths.aggregate(entityType, sessionId), 'utf8'),
          TeachingLedgerRecordSchema,
        ).data as TeachingLedgerRecord;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
      }
    },
    async save(tx, record, expectedVersion) {
      const currentVersion = (await repository.get(record.sessionId))?.resourceVersion ?? 0;
      if (currentVersion !== expectedVersion || record.resourceVersion !== expectedVersion) {
        throw new RepositoryVersionConflictError(currentVersion);
      }
      const data = TeachingLedgerRecordSchema.parse({
        ...record,
        resourceVersion: expectedVersion + 1,
      });
      const absolutePath = paths.aggregate(entityType, record.sessionId);
      const timestamp = new Date().toISOString();
      await tx.stageJson(path.relative(dataRoot.absolutePath, absolutePath).replaceAll('\\', '/'), {
        schema: 'learning-more/teaching-ledger',
        schemaVersion: 1,
        entityType,
        entityId: record.sessionId,
        resourceVersion: data.resourceVersion,
        createdAt: timestamp,
        updatedAt: timestamp,
        contentSha256: checksumJson(data),
        data,
      });
    },
    async delete(tx, sessionId, expectedVersion) {
      const current = await repository.get(sessionId);
      if (current === undefined) return;
      if (current.resourceVersion !== expectedVersion) {
        throw new RepositoryVersionConflictError(current.resourceVersion);
      }
      const absolutePath = paths.aggregate(entityType, sessionId);
      await tx.deleteOnCommit(
        path.relative(dataRoot.absolutePath, absolutePath).replaceAll('\\', '/'),
      );
    },
    async *list(filter = {}) {
      const root = path.join(dataRoot.absolutePath, 'entities', entityType);
      const ids: string[] = [];
      for (const shard of await readdir(root, { withFileTypes: true }).catch(() => [])) {
        if (!shard.isDirectory()) continue;
        for (const file of await readdir(path.join(root, shard.name), { withFileTypes: true })) {
          if (file.isFile() && file.name.endsWith('.json')) ids.push(file.name.slice(0, -5));
        }
      }
      for (const id of ids.sort()) {
        const record = await repository.get(id);
        if (
          record !== undefined &&
          (filter.courseId === undefined || record.courseId === filter.courseId)
        ) {
          yield record;
        }
      }
    },
  };
  return repository;
}
