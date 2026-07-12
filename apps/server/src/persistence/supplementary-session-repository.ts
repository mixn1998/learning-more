import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import type { SupplementarySession } from '../modules/learning-session/model/supplementary-session.js';
import { DataRoot } from './data-root.js';
import { checksumJson, decodeAggregateDocument } from './json-codec.js';
import { createStorePaths } from './paths.js';
import { RepositoryVersionConflictError } from './repository-errors.js';
import type { TransactionContext } from './unit-of-work.js';

export interface SupplementarySessionRepository {
  get(id: string): Promise<SupplementarySession | undefined>;
  save(
    tx: TransactionContext,
    session: SupplementarySession,
    expectedVersion: number,
  ): Promise<void>;
}

export function createInMemorySupplementarySessionRepository(): SupplementarySessionRepository {
  const sessions = new Map<string, SupplementarySession>();
  return {
    get: async (id) => structuredClone(sessions.get(id)),
    async save(_tx, session, expectedVersion) {
      const currentVersion = sessions.get(session.id)?.resourceVersion ?? 0;
      if (currentVersion !== expectedVersion || session.resourceVersion !== expectedVersion) {
        throw new RepositoryVersionConflictError(currentVersion);
      }
      sessions.set(
        session.id,
        structuredClone({ ...session, resourceVersion: expectedVersion + 1 }),
      );
    },
  };
}

const SessionSchema = z.strictObject({
  id: z.string().min(1),
  courseId: z.string().min(1),
  lessonId: z.string().min(1),
  sourceFinalReviewId: z.string().min(1),
  status: z.enum(['active', 'archived']),
  messageIds: z.array(z.string().min(1)),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  resourceVersion: z.number().int().nonnegative(),
});

export function createLocalFileSupplementarySessionRepository(
  dataRoot: DataRoot,
): SupplementarySessionRepository {
  const paths = createStorePaths(dataRoot);
  const repository: SupplementarySessionRepository = {
    async get(id) {
      try {
        return decodeAggregateDocument(
          await readFile(paths.aggregate('lesson-sessions', id), 'utf8'),
          SessionSchema,
        ).data as SupplementarySession;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
      }
    },
    async save(tx, session, expectedVersion) {
      const currentVersion = (await repository.get(session.id))?.resourceVersion ?? 0;
      if (currentVersion !== expectedVersion || session.resourceVersion !== expectedVersion) {
        throw new RepositoryVersionConflictError(currentVersion);
      }
      const data = { ...session, resourceVersion: expectedVersion + 1 };
      const absolute = paths.aggregate('lesson-sessions', session.id);
      await tx.stageJson(path.relative(dataRoot.absolutePath, absolute).replaceAll('\\', '/'), {
        schema: 'learning-more/supplementary-session',
        schemaVersion: 1,
        entityType: 'lesson-sessions',
        entityId: session.id,
        resourceVersion: expectedVersion + 1,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        contentSha256: checksumJson(data),
        data,
      });
    },
  };
  return repository;
}
