import { createHash, randomUUID } from 'node:crypto';

import { RepositoryVersionConflictError } from '../../../persistence/repository-errors.js';
import type { UnitOfWork } from '../../../persistence/unit-of-work.js';
import type { ReviewStateRepository, StageReviewWorkflow } from '../interface.js';

export function reviewIdForLesson(lessonId: string): string {
  return `review_${createHash('sha256').update(lessonId, 'utf8').digest('hex').slice(0, 32)}`;
}

export function createInMemoryReviewStateRepository(): ReviewStateRepository {
  const reviews = new Map<string, Awaited<ReturnType<ReviewStateRepository['get']>>>();
  return {
    get: async (reviewId) => structuredClone(reviews.get(reviewId)),
    async save(_tx, review, expectedVersion) {
      const currentVersion = reviews.get(review.reviewId)?.resourceVersion ?? 0;
      if (currentVersion !== expectedVersion || review.resourceVersion !== expectedVersion) {
        throw new RepositoryVersionConflictError(currentVersion);
      }
      reviews.set(
        review.reviewId,
        structuredClone({ ...review, resourceVersion: expectedVersion + 1 }),
      );
    },
    async *list() {
      for (const id of [...reviews.keys()].sort()) yield structuredClone(reviews.get(id)!);
    },
  };
}

export function createStageReviewWorkflow(options: {
  readonly repository: ReviewStateRepository;
  readonly unitOfWork: UnitOfWork;
  readonly reviewTask: {
    submit(input: {
      kind: 'stage';
      lessonId: string;
      sessionId: string;
      sourceSnapshotHash: string;
      commandId: string;
    }): Promise<{ taskId: string }>;
  };
  readonly now: () => Date;
  readonly providerId?: string;
  readonly commitToLearningSession?: (lessonId: string, reviewId: string) => Promise<void>;
  readonly assertLessonWritable?: (lessonId: string) => Promise<void>;
}): StageReviewWorkflow {
  return {
    async request(input) {
      const reviewId = reviewIdForLesson(input.lessonId);
      const current = await options.repository.get(reviewId);
      const receipt = current?.requestReceipts[input.commandId];
      if (receipt !== undefined) return { reviewId, taskId: receipt };
      if (current?.status === 'generating') return { reviewId, taskId: current.taskId };
      const task = await options.reviewTask.submit({
        kind: 'stage',
        lessonId: input.lessonId,
        sessionId: input.sourceSessionId,
        sourceSnapshotHash: input.sourceSnapshotHash,
        commandId: input.commandId,
      });
      const resourceVersion = current?.resourceVersion ?? 0;
      await options.unitOfWork.execute(
        { transactionId: `tx_stage_review_${randomUUID()}` },
        async (tx) => {
          await options.assertLessonWritable?.(input.lessonId);
          await options.repository.save(
            tx,
            {
              reviewId,
              lessonId: input.lessonId,
              sourceSessionId: input.sourceSessionId,
              sourceSnapshotHash: input.sourceSnapshotHash,
              status: 'generating',
              taskId: task.taskId,
              requestReceipts: {
                ...(current?.requestReceipts ?? {}),
                [input.commandId]: task.taskId,
              },
              replacementCount: current?.replacementCount ?? 0,
              updatedAt: options.now().toISOString(),
              resourceVersion,
            },
            resourceVersion,
          );
        },
      );
      return { reviewId, taskId: task.taskId };
    },
    async fail(input) {
      const current = await options.repository.get(input.reviewId);
      if (current === undefined || current.taskId !== input.taskId) {
        throw new Error('STAGE_REVIEW_TASK_STALE');
      }
      await options.unitOfWork.execute(
        { transactionId: `tx_stage_review_${randomUUID()}` },
        async (tx) => {
          await options.assertLessonWritable?.(current.lessonId);
          await options.repository.save(
            tx,
            {
              ...current,
              status: 'failed',
              errorCode: input.errorCode,
              draftArtifactRef: input.draftArtifactRef,
              updatedAt: options.now().toISOString(),
            },
            current.resourceVersion,
          );
        },
      );
    },
    async commit(input) {
      const current = await options.repository.get(input.reviewId);
      if (current === undefined || current.taskId !== input.taskId) {
        throw new Error('STAGE_REVIEW_TASK_STALE');
      }
      const {
        errorCode: _errorCode,
        draftArtifactRef: _draftArtifactRef,
        ...withoutFailure
      } = current;
      void _errorCode;
      void _draftArtifactRef;
      await options.unitOfWork.execute(
        { transactionId: `tx_stage_review_${randomUUID()}` },
        async (tx) => {
          await options.assertLessonWritable?.(current.lessonId);
          await options.repository.save(
            tx,
            {
              ...withoutFailure,
              status: 'committed',
              artifactRef: input.artifactRef,
              contentSha256: input.contentSha256,
              ...(input.document === undefined ? {} : { document: input.document }),
              replacementCount: current.replacementCount + 1,
              updatedAt: options.now().toISOString(),
            },
            current.resourceVersion,
          );
        },
      );
      await options.commitToLearningSession?.(current.lessonId, current.reviewId);
    },
  };
}
