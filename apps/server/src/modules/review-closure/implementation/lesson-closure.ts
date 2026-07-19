import { randomUUID } from 'node:crypto';

import type { CommandContext } from '@learning-more/contracts';

import { RepositoryVersionConflictError } from '../../../persistence/repository-errors.js';
import type { UnitOfWork } from '../../../persistence/unit-of-work.js';
import type { LearningSessionModule } from '../../learning-session/interface.js';
import type { LessonClosureRepository } from '../interface.js';
import type { LessonClosureRecord } from '../model/review-state.js';
import { validateFinalReview } from './final-review-validator.js';

class LessonClosureError extends Error {
  constructor(
    readonly code: 'lesson_not_completable' | 'source_snapshot_changed' | 'final_review_immutable',
  ) {
    super(code);
    this.name = 'LessonClosureError';
  }
}

export function createInMemoryLessonClosureRepository(): LessonClosureRepository {
  const closures = new Map<string, LessonClosureRecord>();
  return {
    get: async (id) => structuredClone(closures.get(id)),
    async save(_tx, closure, expectedVersion) {
      const current = closures.get(closure.transactionId)?.resourceVersion ?? 0;
      if (current !== expectedVersion || closure.resourceVersion !== expectedVersion) {
        throw new RepositoryVersionConflictError(current);
      }
      closures.set(
        closure.transactionId,
        structuredClone({ ...closure, resourceVersion: expectedVersion + 1 }),
      );
    },
    async *list() {
      for (const id of [...closures.keys()].sort()) yield structuredClone(closures.get(id)!);
    },
  };
}

export function createLessonClosureWorkflow(options: {
  readonly repository: LessonClosureRepository;
  readonly unitOfWork: UnitOfWork;
  readonly sessionModule: LearningSessionModule;
  readonly reviewTask: {
    submit(input: {
      kind: 'final';
      record: LessonClosureRecord;
      commandId: string;
    }): Promise<{ taskId: string }>;
  };
  readonly nextTransactionId: () => string;
  readonly nextReviewId: (lessonId: string) => string;
  readonly now: () => Date;
  readonly assertLessonWritable?: (lessonId: string) => Promise<void>;
  readonly afterLearningCommit?: () => void | Promise<void>;
}) {
  async function save(record: LessonClosureRecord): Promise<LessonClosureRecord> {
    await options.unitOfWork.execute(
      { transactionId: `tx_lesson_closure_${randomUUID()}` },
      async (tx) => {
        await options.assertLessonWritable?.(record.lessonId);
        await options.repository.save(tx, record, record.resourceVersion);
      },
    );
    const stored = await options.repository.get(record.transactionId);
    if (stored === undefined) throw new Error('LESSON_CLOSURE_NOT_PERSISTED');
    return stored;
  }

  async function submit(record: LessonClosureRecord, commandId: string) {
    const task = await options.reviewTask.submit({
      kind: 'final',
      record,
      commandId,
    });
    return task.taskId;
  }

  async function finishCommit(
    record: LessonClosureRecord,
    currentChecksum: string,
    context: CommandContext,
  ) {
    if (record.messageRangeChecksum !== currentChecksum) {
      throw new LessonClosureError('source_snapshot_changed');
    }
    if (record.review === undefined) throw new LessonClosureError('lesson_not_completable');
    const review = record.review;
    const finalReviewId = record.finalReviewId ?? options.nextReviewId(record.lessonId);
    let committing = record;
    if (record.state === 'review-ready') {
      committing = await save({
        ...record,
        state: 'committing',
        finalReviewId,
        updatedAt: options.now().toISOString(),
      });
    }
    const currentView = await options.sessionModule.query(
      { type: 'GetLessonLearning', lessonId: committing.lessonId },
      {
        correlationId: context.correlationId,
        actor: context.actor,
        requestedAt: context.requestedAt,
        receivedAt: context.receivedAt,
      },
    );
    await options.sessionModule.execute(
      {
        type: 'CommitFinalReview',
        lessonId: committing.lessonId,
        reviewId: finalReviewId,
        artifactRef: review.artifactRef,
        contentSha256: review.contentSha256,
        sourceSessionIds: review.sourceSessionIds,
        messageRangeChecksum: review.messageRangeChecksum,
        ...(review.document === undefined ? {} : { document: review.document }),
      },
      {
        ...context,
        commandId: `commit_final_review_${committing.transactionId}`,
        idempotencyKey: `commit_final_review_${committing.transactionId}`,
        expectedVersion: currentView.resourceVersion,
      },
    );
    await options.afterLearningCommit?.();
    return save({
      ...committing,
      state: 'completed',
      finalReviewId,
      updatedAt: options.now().toISOString(),
    });
  }

  return {
    async begin(input: {
      lessonId: string;
      sessionId: string;
      sourceSessionIds: readonly string[];
      sourceMessageIds: readonly string[];
      messageRangeChecksum: string;
      endIntent: string;
      expectedSessionVersion: number;
    }) {
      if (input.sourceMessageIds.length === 0) {
        throw new LessonClosureError('lesson_not_completable');
      }
      for await (const existing of options.repository.list()) {
        if (
          existing.lessonId === input.lessonId &&
          existing.sessionId === input.sessionId &&
          existing.messageRangeChecksum === input.messageRangeChecksum &&
          existing.state !== 'cancelled'
        ) {
          return existing;
        }
      }
      const transactionId = options.nextTransactionId();
      const draft: LessonClosureRecord = {
        transactionId,
        ...input,
        state: 'open',
        generationTaskId: 'pending',
        updatedAt: options.now().toISOString(),
        resourceVersion: 0,
      };
      return save(draft);
    },
    async fail(transactionId: string, errorCode: string, draftArtifactRef: string) {
      const current = await options.repository.get(transactionId);
      if (current === undefined) throw new Error('LESSON_CLOSURE_NOT_FOUND');
      return save({
        ...current,
        state: 'generating-failed',
        errorCode,
        draftArtifactRef,
        updatedAt: options.now().toISOString(),
      });
    },
    async retry(transactionId: string, commandId: string) {
      const current = await options.repository.get(transactionId);
      if (current === undefined) throw new Error('LESSON_CLOSURE_NOT_FOUND');
      if (current.state === 'completed') throw new LessonClosureError('final_review_immutable');
      if (current.state === 'cancelled') throw new LessonClosureError('lesson_not_completable');
      if (current.state === 'generating') return current;
      if (current.state !== 'open' && current.state !== 'generating-failed') {
        throw new LessonClosureError('lesson_not_completable');
      }
      const taskId = await submit(current, commandId);
      const { errorCode: _error, draftArtifactRef: _draft, ...rest } = current;
      void _error;
      void _draft;
      return save({
        ...rest,
        state: 'generating',
        generationTaskId: taskId,
        updatedAt: options.now().toISOString(),
      });
    },
    async markReviewReady(
      transactionId: string,
      review: NonNullable<LessonClosureRecord['review']>,
    ) {
      const current = await options.repository.get(transactionId);
      if (current === undefined) throw new Error('LESSON_CLOSURE_NOT_FOUND');
      if (current.state === 'cancelled') throw new LessonClosureError('lesson_not_completable');
      validateFinalReview(review, current);
      return save({
        ...current,
        state: 'review-ready',
        review,
        updatedAt: options.now().toISOString(),
      });
    },
    async commit(transactionId: string, currentChecksum: string, context: CommandContext) {
      const current = await options.repository.get(transactionId);
      if (current === undefined) throw new Error('LESSON_CLOSURE_NOT_FOUND');
      if (current.state === 'completed') throw new LessonClosureError('final_review_immutable');
      if (current.state !== 'review-ready' && current.state !== 'committing') {
        throw new LessonClosureError('lesson_not_completable');
      }
      return finishCommit(current, currentChecksum, context);
    },
    async recover(transactionId: string, currentChecksum: string, context: CommandContext) {
      const current = await options.repository.get(transactionId);
      if (current === undefined) throw new Error('LESSON_CLOSURE_NOT_FOUND');
      if (current.state !== 'committing') return current;
      return finishCommit(current, currentChecksum, context);
    },
    async cancel(transactionId: string) {
      const current = await options.repository.get(transactionId);
      if (current === undefined) throw new Error('LESSON_CLOSURE_NOT_FOUND');
      if (current.state === 'completed' || current.state === 'committing') {
        throw new LessonClosureError('final_review_immutable');
      }
      if (current.state === 'cancelled') return current;
      return save({
        ...current,
        state: 'cancelled',
        updatedAt: options.now().toISOString(),
      });
    },
  };
}
