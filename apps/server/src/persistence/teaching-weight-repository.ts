import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import type {
  TeachingWeightMetadataRecord,
  TeachingWeightRepository,
} from '../modules/course-authoring/ports/teaching-weight-repository.js';
import type { DataRoot } from './data-root.js';
import { checksumJson, decodeAggregateDocument } from './json-codec.js';
import { createStorePaths } from './paths.js';
import { RepositoryVersionConflictError } from './repository-errors.js';

const TeachingWeightMetadataRecordSchema = z.strictObject({
  schemaVersion: z.literal(1),
  outlineVersionId: z.string().min(1),
  courseId: z.string().min(1),
  analyzerVersion: z.string().min(1),
  sourceSnapshotHash: z.string().regex(/^[a-f0-9]{64}$/u),
  state: z.enum(['generating', 'completed', 'failed']),
  attempt: z.number().int().positive(),
  generationTaskId: z.string().min(1).optional(),
  keyKnowledgePoints: z.array(
    z.strictObject({
      lessonId: z.string().min(1),
      knowledgePointIndex: z.number().int().nonnegative(),
      rationale: z.string().min(1),
    }),
  ),
  errorCode: z.string().min(1).optional(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  resourceVersion: z.number().int().nonnegative(),
});

export function createInMemoryTeachingWeightRepository(): TeachingWeightRepository {
  const records = new Map<string, TeachingWeightMetadataRecord>();
  return {
    get: async (outlineVersionId) => structuredClone(records.get(outlineVersionId)),
    async save(_tx, record, expectedVersion) {
      const currentVersion = records.get(record.outlineVersionId)?.resourceVersion ?? 0;
      if (currentVersion !== expectedVersion || record.resourceVersion !== expectedVersion) {
        throw new RepositoryVersionConflictError(currentVersion);
      }
      records.set(
        record.outlineVersionId,
        structuredClone({ ...record, resourceVersion: expectedVersion + 1 }),
      );
    },
  };
}

export function createLocalFileTeachingWeightRepository(
  dataRoot: DataRoot,
): TeachingWeightRepository {
  const paths = createStorePaths(dataRoot);
  const entityType = 'teaching-weight-metadata';
  const repository: TeachingWeightRepository = {
    async get(outlineVersionId) {
      try {
        return decodeAggregateDocument(
          await readFile(paths.aggregate(entityType, outlineVersionId), 'utf8'),
          TeachingWeightMetadataRecordSchema,
        ).data as TeachingWeightMetadataRecord;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
      }
    },
    async save(tx, record, expectedVersion) {
      const currentVersion = (await repository.get(record.outlineVersionId))?.resourceVersion ?? 0;
      if (currentVersion !== expectedVersion || record.resourceVersion !== expectedVersion) {
        throw new RepositoryVersionConflictError(currentVersion);
      }
      const data = TeachingWeightMetadataRecordSchema.parse({
        ...record,
        resourceVersion: expectedVersion + 1,
      });
      const absolutePath = paths.aggregate(entityType, record.outlineVersionId);
      await tx.stageJson(path.relative(dataRoot.absolutePath, absolutePath).replaceAll('\\', '/'), {
        schema: 'learning-more/teaching-weight-metadata',
        schemaVersion: 1,
        entityType,
        entityId: record.outlineVersionId,
        resourceVersion: data.resourceVersion,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
        contentSha256: checksumJson(data),
        data,
      });
    },
  };
  return repository;
}
