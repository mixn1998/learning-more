import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import type {
  PersonalizationDigestRecord,
  PersonalizationDigestRepository,
} from '../modules/global-user-profile/ports/personalization-digest-repository.js';
import { checksumJson, decodeAggregateDocument } from './json-codec.js';
import { createStorePaths } from './paths.js';
import { RepositoryVersionConflictError } from './repository-errors.js';
import type { DataRoot } from './data-root.js';

const SnapshotSchema = z.strictObject({
  projectionVersion: z.literal('semantic-profile-digest@1').optional(),
  profileVersion: z.number().int().nonnegative(),
  sourceSnapshotHash: z.string().length(64),
  summary: z.string(),
  selectedModeIds: z.array(z.string().min(1)).max(4).optional(),
  sourceRefs: z.array(z.string()),
  generatedAt: z.iso.datetime({ offset: true }),
});
const RecordSchema = z.strictObject({
  digestId: z.literal('interactive_teaching'),
  resourceVersion: z.number().int().nonnegative(),
  requestedProfileVersion: z.number().int().nonnegative(),
  requestedSourceSnapshotHash: z.string().length(64),
  refreshStatus: z.enum(['pending', 'succeeded', 'failed']),
  latestSuccessful: SnapshotSchema.optional(),
  lastError: z.string().optional(),
  updatedAt: z.iso.datetime({ offset: true }),
});

export function createInMemoryPersonalizationDigestRepository(): PersonalizationDigestRepository {
  let current: PersonalizationDigestRecord | undefined;
  return {
    get: async () => (current === undefined ? undefined : structuredClone(current)),
    async save(_tx, record, expectedVersion) {
      const currentVersion = current?.resourceVersion ?? 0;
      if (currentVersion !== expectedVersion || record.resourceVersion !== expectedVersion) {
        throw new RepositoryVersionConflictError(currentVersion);
      }
      current = structuredClone({ ...record, resourceVersion: expectedVersion + 1 });
    },
  };
}

export function createLocalFilePersonalizationDigestRepository(
  dataRoot: DataRoot,
): PersonalizationDigestRepository {
  const paths = createStorePaths(dataRoot);
  const entityType = 'personalization-digests';
  const entityId = 'interactive_teaching';
  const repository: PersonalizationDigestRepository = {
    async get() {
      try {
        const stored = decodeAggregateDocument(
          await readFile(paths.aggregate(entityType, entityId), 'utf8'),
          RecordSchema,
        ).data;
        const latestSuccessful = stored.latestSuccessful;
        return {
          ...stored,
          ...(latestSuccessful?.projectionVersion === 'semantic-profile-digest@1'
            ? {
                latestSuccessful: {
                  ...latestSuccessful,
                  projectionVersion: latestSuccessful.projectionVersion,
                  selectedModeIds: latestSuccessful.selectedModeIds ?? [],
                },
              }
            : { latestSuccessful: undefined }),
        } as PersonalizationDigestRecord;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
      }
    },
    async save(tx, record, expectedVersion) {
      const currentVersion = (await repository.get())?.resourceVersion ?? 0;
      if (currentVersion !== expectedVersion || record.resourceVersion !== expectedVersion) {
        throw new RepositoryVersionConflictError(currentVersion);
      }
      const stored = RecordSchema.parse({ ...record, resourceVersion: expectedVersion + 1 });
      const timestamp = new Date().toISOString();
      const absolutePath = paths.aggregate(entityType, entityId);
      await tx.stageJson(path.relative(dataRoot.absolutePath, absolutePath).replaceAll('\\', '/'), {
        schema: `learning-more/${entityType}`,
        schemaVersion: 1,
        entityType,
        entityId,
        resourceVersion: stored.resourceVersion,
        createdAt: timestamp,
        updatedAt: timestamp,
        contentSha256: checksumJson(stored),
        data: stored,
      });
    },
  };
  return repository;
}
