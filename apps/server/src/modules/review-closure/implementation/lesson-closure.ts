import { randomUUID } from 'node:crypto';

import type { CommandContext } from '@learning-more/contracts';

import { RepositoryVersionConflictError } from '../../../persistence/repository-errors.js';
import type { UnitOfWork } from '../../../persistence/unit-of-work.js';
import type { LearningSessionModule } from '../../learning-session/interface.js';
import type { LessonClosureRepository } from '../interface.js';
import type { LessonClosureRecord, LessonClosureWorkflowStage } from '../model/review-state.js';
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
  const pairKey = (lessonId: string, sessionId: string) => `${lessonId}\u0000${sessionId}`;
  const closureIdsByPair = new Map<string, Set<string>>();
  const matching = (lessonId: string, sessionId: string) =>
    [...(closureIdsByPair.get(pairKey(lessonId, sessionId)) ?? [])]
      .map((id) => closures.get(id))
      .filter(
        (closure): closure is LessonClosureRecord =>
          closure !== undefined && closure.state !== 'cancelled',
      )
      .sort((left, right) =>
        left.updatedAt === right.updatedAt
          ? right.transactionId.localeCompare(left.transactionId)
          : right.updatedAt.localeCompare(left.updatedAt),
      );
  return {
    initialize: async () => undefined,
    get: async (id) => structuredClone(closures.get(id)),
    findLatest: async (lessonId, sessionId) => structuredClone(matching(lessonId, sessionId)[0]),
    findBySnapshot: async (lessonId, sessionId, messageRangeChecksum) =>
      structuredClone(
        matching(lessonId, sessionId).find(
          (closure) => closure.messageRangeChecksum === messageRangeChecksum,
        ),
      ),
    async save(_tx, closure, expectedVersion) {
      const current = closures.get(closure.transactionId)?.resourceVersion ?? 0;
      if (current !== expectedVersion || closure.resourceVersion !== expectedVersion) {
        throw new RepositoryVersionConflictError(current);
      }
      closures.set(
        closure.transactionId,
        structuredClone({ ...closure, resourceVersion: expectedVersion + 1 }),
      );
      const key = pairKey(closure.lessonId, closure.sessionId);
      const ids = closureIdsByPair.get(key) ?? new Set<string>();
      ids.add(closure.transactionId);
      closureIdsByPair.set(key, ids);
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
    const {
      errorCode: _error,
      draftArtifactRef: _draft,
      failureStage: _stage,
      nextAttemptAt: _next,
      lastAttemptAt: _last,
      ...completed
    } = committing;
    void _error;
    void _draft;
    void _stage;
    void _next;
    void _last;
    return save({
      ...completed,
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
      const existing = await options.repository.findBySnapshot(
        input.lessonId,
        input.sessionId,
        input.messageRangeChecksum,
      );
      if (existing !== undefined) return existing;
      const transactionId = options.nextTransactionId();
      const draft: LessonClosureRecord = {
        transactionId,
        ...input,
        state: 'open',
        generationTaskId: 'pending',
        workflowAttempt: 0,
        updatedAt: options.now().toISOString(),
        resourceVersion: 0,
      };
      return save(draft);
    },
    async fail(
      transactionId: string,
      errorCode: string,
      draftArtifactRef: string,
      failure?: Readonly<{ stage: LessonClosureWorkflowStage; nextAttemptAt?: string }>,
    ) {
      const current = await options.repository.get(transactionId);
      if (current === undefined) throw new Error('LESSON_CLOSURE_NOT_FOUND');
      const attemptedAt = options.now().toISOString();
      return save({
        ...current,
        state: 'generating-failed',
        errorCode,
        draftArtifactRef,
        workflowAttempt: (current.workflowAttempt ?? 0) + 1,
        failureStage: failure?.stage ?? 'generating',
        lastAttemptAt: attemptedAt,
        ...(failure?.nextAttemptAt === undefined
          ? { nextAttemptAt: attemptedAt }
          : { nextAttemptAt: failure.nextAttemptAt }),
        updatedAt: attemptedAt,
      });
    },
    async defer(
      transactionId: string,
      failure: Readonly<{
        stage: LessonClosureWorkflowStage;
        errorCode: string;
        nextAttemptAt: string;
      }>,
    ) {
      const current = await options.repository.get(transactionId);
      if (current === undefined) throw new Error('LESSON_CLOSURE_NOT_FOUND');
      const attemptedAt = options.now().toISOString();
      return save({
        ...current,
        errorCode: failure.errorCode,
        workflowAttempt: (current.workflowAttempt ?? 0) + 1,
        failureStage: failure.stage,
        lastAttemptAt: attemptedAt,
        nextAttemptAt: failure.nextAttemptAt,
        updatedAt: attemptedAt,
      });
    },
    async clearFailure(transactionId: string) {
      const current = await options.repository.get(transactionId);
      if (current === undefined) throw new Error('LESSON_CLOSURE_NOT_FOUND');
      const {
        errorCode: _error,
        draftArtifactRef: _draft,
        failureStage: _stage,
        nextAttemptAt: _next,
        lastAttemptAt: _last,
        ...rest
      } = current;
      void _error;
      void _draft;
      void _stage;
      void _next;
      void _last;
      return save({
        ...rest,
        workflowAttempt: 0,
        updatedAt: options.now().toISOString(),
      });
    },
    async resetPreparation(transactionId: string, resetAttempts = true) {
      const current = await options.repository.get(transactionId);
      if (current === undefined) throw new Error('LESSON_CLOSURE_NOT_FOUND');
      if (current.state === 'completed') throw new LessonClosureError('final_review_immutable');
      if (current.state === 'cancelled') throw new LessonClosureError('lesson_not_completable');
      if (current.state !== 'generating-failed') return current;
      const {
        errorCode: _error,
        draftArtifactRef: _draft,
        failureStage: _stage,
        nextAttemptAt: _next,
        lastAttemptAt: _last,
        ...rest
      } = current;
      void _error;
      void _draft;
      void _stage;
      void _next;
      void _last;
      return save({
        ...rest,
        state: 'open',
        generationTaskId: 'pending',
        workflowAttempt: resetAttempts ? 0 : (current.workflowAttempt ?? 0),
        updatedAt: options.now().toISOString(),
      });
    },
    async replaceSnapshot(
      transactionId: string,
      snapshot: Readonly<{
        sourceSessionIds: readonly string[];
        sourceMessageIds: readonly string[];
        messageRangeChecksum: string;
      }>,
    ) {
      const current = await options.repository.get(transactionId);
      if (current === undefined) throw new Error('LESSON_CLOSURE_NOT_FOUND');
      if (current.state !== 'open') throw new LessonClosureError('lesson_not_completable');
      if (snapshot.sourceMessageIds.length === 0) {
        throw new LessonClosureError('lesson_not_completable');
      }
      return save({
        ...current,
        ...snapshot,
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
      const {
        errorCode: _error,
        draftArtifactRef: _draft,
        failureStage: _stage,
        nextAttemptAt: _next,
        lastAttemptAt: _last,
        ...rest
      } = current;
      void _error;
      void _draft;
      void _stage;
      void _next;
      void _last;
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
      const {
        errorCode: _error,
        draftArtifactRef: _draft,
        failureStage: _stage,
        nextAttemptAt: _next,
        lastAttemptAt: _last,
        ...rest
      } = current;
      void _error;
      void _draft;
      void _stage;
      void _next;
      void _last;
      return save({
        ...rest,
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
