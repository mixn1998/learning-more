import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import type { LessonLearning } from '../modules/learning-session/model/learning-session.js';
import type { LearningTimeInterval } from '../modules/learning-session/implementation/time-intervals.js';
import type { SessionWriteLease } from '../modules/learning-session/implementation/session-write-lease.js';
import type { TransactionContext } from './unit-of-work.js';
import { RepositoryVersionConflictError } from './repository-errors.js';
import { DataRoot } from './data-root.js';
import { checksumJson, decodeAggregateDocument } from './json-codec.js';
import { createStorePaths } from './paths.js';

export type LearningSessionRecord = Readonly<{
  lessonId: string;
  learning: LessonLearning;
  intervals: readonly LearningTimeInterval[];
  writeLease?: SessionWriteLease;
  resourceVersion: number;
}>;

export interface LearningSessionRepositories {
  get(lessonId: string): Promise<LearningSessionRecord | undefined>;
  save(
    tx: TransactionContext,
    record: LearningSessionRecord,
    expectedVersion: number,
  ): Promise<void>;
  list(): AsyncIterable<LearningSessionRecord>;
}

export function createInMemoryLearningSessionRepositories(): LearningSessionRepositories {
  const records = new Map<string, LearningSessionRecord>();
  return {
    get: async (lessonId) => structuredClone(records.get(lessonId)),
    async save(_tx, record, expectedVersion) {
      const current = records.get(record.lessonId)?.resourceVersion ?? 0;
      if (current !== expectedVersion || record.resourceVersion !== expectedVersion) {
        throw new RepositoryVersionConflictError(current);
      }
      records.set(
        record.lessonId,
        structuredClone({ ...record, resourceVersion: expectedVersion + 1 }),
      );
    },
    async *list() {
      for (const key of [...records.keys()].sort()) yield structuredClone(records.get(key)!);
    },
  };
}

const OriginalSessionSchema = z.strictObject({
  id: z.string().min(1),
  state: z.enum(['active', 'paused', 'frozen', 'closed']),
  messageIds: z.array(z.string()),
  evidenceCheckpoint: z.boolean(),
  activeGenerationTaskId: z.string().optional(),
  finalReviewId: z.string().optional(),
});
const LessonLearningSchema = z.strictObject({
  lessonId: z.string().min(1),
  progress: z.enum(['not_started', 'in_progress', 'abandoned', 'completed']),
  session: OriginalSessionSchema.optional(),
  processedCommandIds: z.array(z.string()),
});
const IntervalSchema = z.strictObject({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  startedAt: z.iso.datetime({ offset: true }),
  endedAt: z.iso.datetime({ offset: true }).optional(),
  endReason: z
    .enum(['paused', 'hidden', 'lease_lost', 'abandoned', 'completed', 'recovered'])
    .optional(),
  recovered: z.boolean(),
});
const LeaseSchema = z.strictObject({
  token: z.string().min(1),
  pageInstanceId: z.string().min(1),
  instanceId: z.string().min(1),
  generation: z.number().int().positive(),
  heartbeatAt: z.iso.datetime({ offset: true }),
  visibilityState: z.enum(['visible', 'hidden']),
});
const RecordSchema = z.strictObject({
  lessonId: z.string().min(1),
  learning: LessonLearningSchema,
  intervals: z.array(IntervalSchema),
  writeLease: LeaseSchema.optional(),
  resourceVersion: z.number().int().nonnegative(),
});

export function createLocalFileLearningSessionRepositories(
  dataRoot: DataRoot,
): LearningSessionRepositories {
  const paths = createStorePaths(dataRoot);
  const repository: LearningSessionRepositories = {
    async get(lessonId) {
      try {
        return decodeAggregateDocument(
          await readFile(paths.aggregate('lesson-progress', lessonId), 'utf8'),
          RecordSchema,
        ).data as LearningSessionRecord;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
      }
    },
    async save(tx, record, expectedVersion) {
      const currentVersion = (await repository.get(record.lessonId))?.resourceVersion ?? 0;
      if (currentVersion !== expectedVersion || record.resourceVersion !== expectedVersion) {
        throw new RepositoryVersionConflictError(currentVersion);
      }
      const data = { ...record, resourceVersion: expectedVersion + 1 };
      const absolute = paths.aggregate('lesson-progress', record.lessonId);
      const timestamp = new Date().toISOString();
      await tx.stageJson(path.relative(dataRoot.absolutePath, absolute).replaceAll('\\', '/'), {
        schema: 'learning-more/lesson-progress',
        schemaVersion: 1,
        entityType: 'lesson-progress',
        entityId: record.lessonId,
        resourceVersion: expectedVersion + 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        contentSha256: checksumJson(data),
        data,
      });
    },
    async *list() {
      const root = path.join(dataRoot.absolutePath, 'entities', 'lesson-progress');
      const ids: string[] = [];
      for (const shard of await readdir(root, { withFileTypes: true }).catch(() => [])) {
        if (!shard.isDirectory()) continue;
        for (const file of await readdir(path.join(root, shard.name), { withFileTypes: true })) {
          if (file.isFile() && file.name.endsWith('.json')) ids.push(file.name.slice(0, -5));
        }
      }
      for (const id of ids.sort()) {
        const record = await repository.get(id);
        if (record !== undefined) yield record;
      }
    },
  };
  return repository;
}
