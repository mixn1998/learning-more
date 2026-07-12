import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

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
import type { TransactionContext } from './unit-of-work.js';

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
  updatedAt: timestamp,
  resourceVersion: version,
});

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

  const lessonClosures: LessonClosureRepository = {
    get: async (transactionId) =>
      (await readRecord({
        dataRoot,
        entityType: 'lesson-closures',
        entityId: transactionId,
        schema: LessonClosureSchema,
      })) as LessonClosureRecord | undefined,
    async save(tx, closure, expectedVersion) {
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
  };

  return { stageReviews, lessonClosures, courseReviews };
}
