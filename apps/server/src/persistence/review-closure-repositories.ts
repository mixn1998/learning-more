import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import { ReviewDocumentSchema } from '@learning-more/contracts';

import type {
  CourseReviewRecord,
  CourseReviewRepository,
  LessonClosureRepository,
  ReviewStateRepository,
} from '../modules/review-closure/interface.js';
import type {
  LessonClosureRecord,
  StageReviewState,
} from '../modules/review-closure/model/review-state.js';
import { DataRoot } from './data-root.js';
import { checksumJson, decodeAggregateDocument } from './json-codec.js';
import { createStorePaths } from './paths.js';
import { ImmutableResourceError, RepositoryVersionConflictError } from './repository-errors.js';
import type { TransactionContext, UnitOfWork } from './unit-of-work.js';

const identifier = z.string().min(1);
const checksum = z.string().regex(/^[a-f0-9]{64}$/);
const version = z.number().int().nonnegative();
const timestamp = z.iso.datetime({ offset: true });

const StageReviewSchema = z.strictObject({
  reviewId: identifier,
  lessonId: identifier,
  sourceSessionId: identifier,
  sourceSnapshotHash: checksum,
  status: z.enum(['generating', 'failed', 'committed']),
  taskId: identifier,
  requestReceipts: z.record(identifier, identifier),
  artifactRef: identifier.optional(),
  contentSha256: checksum.optional(),
  document: ReviewDocumentSchema.optional(),
  errorCode: identifier.optional(),
  draftArtifactRef: identifier.optional(),
  replacementCount: z.number().int().nonnegative(),
  updatedAt: timestamp,
  resourceVersion: version,
});

const FinalReviewDraftSchema = z.strictObject({
  artifactRef: identifier,
  markdown: z.string(),
  sourceSessionIds: z.array(identifier).min(1),
  messageRangeChecksum: checksum,
  contentSha256: checksum,
  document: ReviewDocumentSchema.optional(),
});

const LessonClosureSchema = z.strictObject({
  transactionId: identifier,
  lessonId: identifier,
  sessionId: identifier,
  state: z.enum([
    'open',
    'generating',
    'generating-failed',
    'review-ready',
    'committing',
    'completed',
    'cancelled',
  ]),
  sourceSessionIds: z.array(identifier).min(1),
  sourceMessageIds: z.array(identifier).min(1),
  messageRangeChecksum: checksum,
  endIntent: z.string().min(1),
  expectedSessionVersion: version,
  generationTaskId: identifier,
  review: FinalReviewDraftSchema.optional(),
  finalReviewId: identifier.optional(),
  errorCode: identifier.optional(),
  draftArtifactRef: identifier.optional(),
  workflowAttempt: z.number().int().nonnegative().optional(),
  failureStage: z
    .enum(['preparing', 'generating', 'finalizing', 'committing', 'post-commit'])
    .optional(),
  lastAttemptAt: timestamp.optional(),
  nextAttemptAt: timestamp.optional(),
  updatedAt: timestamp,
  resourceVersion: version,
});

const LessonClosureIndexEntrySchema = z.strictObject({
  transactionId: identifier,
  messageRangeChecksum: checksum,
  state: LessonClosureSchema.shape.state,
  updatedAt: timestamp,
});

const LessonClosureIndexSchema = z.strictObject({
  schemaVersion: z.literal(1),
  lessonId: identifier,
  sessionId: identifier,
  entries: z.array(LessonClosureIndexEntrySchema),
  updatedAt: timestamp,
});

const LessonClosureIndexMigrationSchema = z.strictObject({
  schemaVersion: z.literal(1),
  completedAt: timestamp,
});

type LessonClosureIndex = z.infer<typeof LessonClosureIndexSchema>;

const lessonClosureIndexMigrationPath = 'indexes/lesson-closures/_complete.json';

export function lessonClosureIndexRelativePath(lessonId: string, sessionId: string): string {
  const key = createHash('sha256').update(`${lessonId}\u0000${sessionId}`, 'utf8').digest('hex');
  return `indexes/lesson-closures/${key}.json`;
}

const CourseReviewInputManifestSchema = z.strictObject({
  outlineVersionId: identifier,
  completedFinalReviewRefs: z.array(identifier),
  abandonedStageReviewRefs: z.array(identifier),
  abandonedWithoutReviewLessonIds: z.array(identifier),
});

const CourseReviewSchema = z.strictObject({
  courseId: identifier,
  state: z.enum([
    'closed',
    'generating-review',
    'review-ready',
    'review-failed',
    'review-finalized',
  ]),
  inputManifest: CourseReviewInputManifestSchema,
  generationTaskId: identifier.optional(),
  artifactRef: identifier.optional(),
  contentSha256: checksum.optional(),
  document: ReviewDocumentSchema.optional(),
  errorCode: identifier.optional(),
  draftArtifactRef: identifier.optional(),
  resourceVersion: version,
});

type Versioned = Readonly<{ resourceVersion: number }>;

function relativePath(dataRoot: DataRoot, absolutePath: string): string {
  return path.relative(dataRoot.absolutePath, absolutePath).replaceAll('\\', '/');
}

async function readRecord<T>(options: {
  dataRoot: DataRoot;
  entityType: string;
  entityId: string;
  schema: z.ZodType<T>;
}): Promise<T | undefined> {
  const paths = createStorePaths(options.dataRoot);
  try {
    return decodeAggregateDocument(
      await readFile(paths.aggregate(options.entityType, options.entityId), 'utf8'),
      options.schema,
    ).data;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

async function saveRecord<T extends Versioned>(options: {
  tx: TransactionContext;
  dataRoot: DataRoot;
  entityType: string;
  entityId: string;
  schemaName: string;
  value: T;
  expectedVersion: number;
  current: T | undefined;
  updatedAt?: string;
}): Promise<void> {
  const currentVersion = options.current?.resourceVersion ?? 0;
  if (
    currentVersion !== options.expectedVersion ||
    options.value.resourceVersion !== options.expectedVersion
  ) {
    throw new RepositoryVersionConflictError(currentVersion);
  }
  const data = { ...options.value, resourceVersion: options.expectedVersion + 1 };
  const now = options.updatedAt ?? new Date().toISOString();
  const target = createStorePaths(options.dataRoot).aggregate(options.entityType, options.entityId);
  await options.tx.stageJson(relativePath(options.dataRoot, target), {
    schema: options.schemaName,
    schemaVersion: 1,
    entityType: options.entityType,
    entityId: options.entityId,
    resourceVersion: options.expectedVersion + 1,
    createdAt: now,
    updatedAt: now,
    contentSha256: checksumJson(data),
    data,
  });
}

async function listIds(dataRoot: DataRoot, entityType: string): Promise<readonly string[]> {
  const root = path.join(dataRoot.absolutePath, 'entities', entityType);
  const ids: string[] = [];
  for (const shard of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!shard.isDirectory()) continue;
    for (const file of await readdir(path.join(root, shard.name), { withFileTypes: true })) {
      if (file.isFile() && file.name.endsWith('.json')) ids.push(file.name.slice(0, -5));
    }
  }
  return ids.sort();
}

export type LocalFileReviewClosureRepositories = Readonly<{
  stageReviews: ReviewStateRepository;
  lessonClosures: LessonClosureRepository;
  courseReviews: CourseReviewRepository;
}>;

export function createLocalFileReviewClosureRepositories(
  dataRoot: DataRoot,
  unitOfWork: UnitOfWork,
): LocalFileReviewClosureRepositories {
  const stageReviews: ReviewStateRepository = {
    get: async (reviewId) =>
      (await readRecord({
        dataRoot,
        entityType: 'reviews',
        entityId: reviewId,
        schema: StageReviewSchema,
      })) as StageReviewState | undefined,
    async save(tx, review, expectedVersion) {
      await saveRecord({
        tx,
        dataRoot,
        entityType: 'reviews',
        entityId: review.reviewId,
        schemaName: 'learning-more/stage-review',
        value: review,
        expectedVersion,
        current: await stageReviews.get(review.reviewId),
        updatedAt: review.updatedAt,
      });
    },
    async *list() {
      for (const id of await listIds(dataRoot, 'reviews')) {
        const review = await stageReviews.get(id);
        if (review !== undefined) yield review;
      }
    },
  };

  async function readIndexJson(relative: string): Promise<unknown | undefined> {
    try {
      return JSON.parse(
        await readFile(path.join(dataRoot.absolutePath, ...relative.split('/')), 'utf8'),
      ) as unknown;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  function indexFromClosures(
    lessonId: string,
    sessionId: string,
    closures: readonly LessonClosureRecord[],
  ): LessonClosureIndex {
    const entries = closures
      .filter((closure) => closure.lessonId === lessonId && closure.sessionId === sessionId)
      .map((closure) => ({
        transactionId: closure.transactionId,
        messageRangeChecksum: closure.messageRangeChecksum,
        state: closure.state,
        updatedAt: closure.updatedAt,
      }))
      .sort((left, right) => left.transactionId.localeCompare(right.transactionId));
    return {
      schemaVersion: 1,
      lessonId,
      sessionId,
      entries,
      updatedAt:
        entries.reduce(
          (latest, entry) => (entry.updatedAt > latest ? entry.updatedAt : latest),
          '',
        ) || new Date().toISOString(),
    };
  }

  async function allLessonClosures(): Promise<LessonClosureRecord[]> {
    const closures: LessonClosureRecord[] = [];
    for (const id of await listIds(dataRoot, 'lesson-closures')) {
      const closure = (await readRecord({
        dataRoot,
        entityType: 'lesson-closures',
        entityId: id,
        schema: LessonClosureSchema,
      })) as LessonClosureRecord | undefined;
      if (closure !== undefined) closures.push(closure);
    }
    return closures;
  }

  async function migrateLessonClosureIndexes(): Promise<void> {
    const marker = await readIndexJson(lessonClosureIndexMigrationPath).catch(() => undefined);
    if (LessonClosureIndexMigrationSchema.safeParse(marker).success) return;
    const closures = await allLessonClosures();
    const groups = new Map<string, LessonClosureRecord[]>();
    for (const closure of closures) {
      const key = `${closure.lessonId}\u0000${closure.sessionId}`;
      const group = groups.get(key) ?? [];
      group.push(closure);
      groups.set(key, group);
    }
    const completedAt = new Date().toISOString();
    await unitOfWork.execute(
      {
        transactionId: `tx_migrate_lesson_closure_indexes_${createHash('sha256').update(completedAt).digest('hex').slice(0, 16)}`,
      },
      async (tx) => {
        for (const group of groups.values()) {
          const first = group[0];
          if (first === undefined) continue;
          const index = indexFromClosures(first.lessonId, first.sessionId, group);
          await tx.stageJson(
            lessonClosureIndexRelativePath(first.lessonId, first.sessionId),
            index,
          );
        }
        await tx.stageJson(lessonClosureIndexMigrationPath, { schemaVersion: 1, completedAt });
      },
    );
  }

  let migration: Promise<void> | undefined;
  let indexesReady = false;
  async function ensureIndexesReady(): Promise<void> {
    migration ??= migrateLessonClosureIndexes().catch((error: unknown) => {
      migration = undefined;
      throw error;
    });
    await migration;
    indexesReady = true;
  }

  async function rebuildPairIndex(
    lessonId: string,
    sessionId: string,
  ): Promise<LessonClosureIndex> {
    return indexFromClosures(lessonId, sessionId, await allLessonClosures());
  }

  async function readPairIndex(
    lessonId: string,
    sessionId: string,
    repair = true,
  ): Promise<LessonClosureIndex | undefined> {
    const raw = await readIndexJson(lessonClosureIndexRelativePath(lessonId, sessionId));
    if (raw === undefined) return undefined;
    const parsed = LessonClosureIndexSchema.safeParse(raw);
    if (
      !parsed.success ||
      parsed.data.lessonId !== lessonId ||
      parsed.data.sessionId !== sessionId
    ) {
      const repaired = await rebuildPairIndex(lessonId, sessionId);
      if (repair) {
        await unitOfWork.execute(
          {
            transactionId: `tx_repair_lesson_closure_index_${createHash('sha256').update(`${lessonId}\u0000${sessionId}`).digest('hex').slice(0, 16)}`,
          },
          (tx) => tx.stageJson(lessonClosureIndexRelativePath(lessonId, sessionId), repaired),
        );
      }
      return repaired;
    }
    return parsed.data;
  }

  async function indexedClosures(
    lessonId: string,
    sessionId: string,
  ): Promise<LessonClosureRecord[]> {
    await ensureIndexesReady();
    const index = await readPairIndex(lessonId, sessionId);
    if (index === undefined) return [];
    const closures = await Promise.all(
      index.entries.map(
        (entry) =>
          readRecord({
            dataRoot,
            entityType: 'lesson-closures',
            entityId: entry.transactionId,
            schema: LessonClosureSchema,
          }) as Promise<LessonClosureRecord | undefined>,
      ),
    );
    return closures
      .filter(
        (closure): closure is LessonClosureRecord =>
          closure !== undefined &&
          closure.lessonId === lessonId &&
          closure.sessionId === sessionId &&
          closure.state !== 'cancelled',
      )
      .sort((left, right) =>
        left.updatedAt === right.updatedAt
          ? right.transactionId.localeCompare(left.transactionId)
          : right.updatedAt.localeCompare(left.updatedAt),
      );
  }

  const lessonClosures: LessonClosureRepository = {
    initialize: ensureIndexesReady,
    get: async (transactionId) =>
      (await readRecord({
        dataRoot,
        entityType: 'lesson-closures',
        entityId: transactionId,
        schema: LessonClosureSchema,
      })) as LessonClosureRecord | undefined,
    async findLatest(lessonId, sessionId) {
      return (await indexedClosures(lessonId, sessionId))[0];
    },
    async findBySnapshot(lessonId, sessionId, messageRangeChecksum) {
      return (await indexedClosures(lessonId, sessionId)).find(
        (closure) => closure.messageRangeChecksum === messageRangeChecksum,
      );
    },
    async save(tx, closure, expectedVersion) {
      if (!indexesReady) throw new Error('lesson_closure_repository_not_initialized');
      await saveRecord({
        tx,
        dataRoot,
        entityType: 'lesson-closures',
        entityId: closure.transactionId,
        schemaName: 'learning-more/lesson-closure',
        value: closure,
        expectedVersion,
        current: await lessonClosures.get(closure.transactionId),
        updatedAt: closure.updatedAt,
      });
      let index: LessonClosureIndex;
      try {
        index =
          (await readPairIndex(closure.lessonId, closure.sessionId, false)) ??
          indexFromClosures(closure.lessonId, closure.sessionId, []);
      } catch {
        index = await rebuildPairIndex(closure.lessonId, closure.sessionId);
      }
      const entries = index.entries.filter(
        (entry) => entry.transactionId !== closure.transactionId,
      );
      entries.push({
        transactionId: closure.transactionId,
        messageRangeChecksum: closure.messageRangeChecksum,
        state: closure.state,
        updatedAt: closure.updatedAt,
      });
      await tx.stageJson(lessonClosureIndexRelativePath(closure.lessonId, closure.sessionId), {
        schemaVersion: 1,
        lessonId: closure.lessonId,
        sessionId: closure.sessionId,
        entries: entries.sort((left, right) =>
          left.transactionId.localeCompare(right.transactionId),
        ),
        updatedAt: closure.updatedAt,
      } satisfies LessonClosureIndex);
    },
    async *list() {
      for (const id of await listIds(dataRoot, 'lesson-closures')) {
        const closure = await lessonClosures.get(id);
        if (closure !== undefined) yield closure;
      }
    },
  };

  const courseReviews: CourseReviewRepository = {
    get: async (courseId) =>
      (await readRecord({
        dataRoot,
        entityType: 'course-reviews',
        entityId: courseId,
        schema: CourseReviewSchema,
      })) as CourseReviewRecord | undefined,
    async save(tx, record, expectedVersion) {
      const current = await courseReviews.get(record.courseId);
      if (current?.state === 'review-finalized') throw new ImmutableResourceError();
      await saveRecord({
        tx,
        dataRoot,
        entityType: 'course-reviews',
        entityId: record.courseId,
        schemaName: 'learning-more/course-review',
        value: record,
        expectedVersion,
        current,
      });
    },
    async *list() {
      for (const id of await listIds(dataRoot, 'course-reviews')) {
        const review = await courseReviews.get(id);
        if (review !== undefined) yield review;
      }
    },
  };

  return { stageReviews, lessonClosures, courseReviews };
}
