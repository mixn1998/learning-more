import { createHash, randomUUID } from 'node:crypto';

import type { CommandContext } from '@learning-more/contracts';

import type { ReviewClosureRouteOptions } from '../../http/routes/review-closure.js';
import { closeCourse as closeCourseAggregate } from '../../modules/course-authoring/implementation/close-course.js';
import { createGenerationReviewWriter } from '../../modules/review-closure/implementation/generation-review-writer.js';
import { createLessonClosureWorkflow } from '../../modules/review-closure/implementation/lesson-closure.js';
import type {
  LessonClosureRecord,
  LessonClosureWorkflowStage,
} from '../../modules/review-closure/model/review-state.js';
import {
  createStageReviewWorkflow,
  reviewIdForLesson,
} from '../../modules/review-closure/implementation/stage-review.js';
import type { DataRoot } from '../../persistence/data-root.js';
import { createMarkdownArtifactStore } from '../../persistence/markdown-artifact-store.js';
import { createLocalFileReviewClosureRepositories } from '../../persistence/review-closure-repositories.js';
import type { UnitOfWork } from '../../persistence/unit-of-work.js';
import type { LocalCourseRuntime } from './course-runtime.js';
import type { LocalEventFactsRuntime } from './event-facts-runtime.js';
import type { LocalGenerationRuntime } from './generation-runtime.js';
import type { LocalLearningRuntime } from './learning-runtime.js';
import { createNextLessonRefresh } from './next-lesson-refresh.js';
import type { LocalPlanningRuntime } from './planning-runtime.js';
import type { LocalProfileRuntime } from './profile-runtime.js';
import { createLocalCourseReviewRuntime } from './course-review-runtime.js';
import { createReviewEvidence } from './review-evidence.js';
import { createReviewProfileCheckpointCapture } from './review-profile-checkpoints.js';
import { collectRecoverableReviewProfileCheckpoints } from './review-profile-recovery.js';

export type LocalReviewRuntime = Readonly<{
  routes: ReviewClosureRouteOptions;
  recoverCommittingClosures(): Promise<void>;
  recoverProfileCheckpoints(): Promise<void>;
  close(): Promise<void>;
}>;

export function createLocalReviewRuntime(
  input: Readonly<{
    dataRoot: DataRoot;
    unitOfWork: UnitOfWork;
    artifactStore: ReturnType<typeof createMarkdownArtifactStore>;
    now: () => Date;
    course: LocalCourseRuntime;
    learning: LocalLearningRuntime;
    planning: LocalPlanningRuntime;
    generation: LocalGenerationRuntime;
    events: LocalEventFactsRuntime;
    profile: LocalProfileRuntime;
    reconcileIntervalMs?: number;
  }>,
): LocalReviewRuntime {
  const reviewClosureRepositories = createLocalFileReviewClosureRepositories(
    input.dataRoot,
    input.unitOfWork,
  );
  const sessionModule = input.learning.access.sessionModule;
  const teachingRuntime = input.learning.access.teachingRuntime;
  const refreshNextLessonRecommendation = createNextLessonRefresh({
    unitOfWork: input.unitOfWork,
    artifactStore: input.artifactStore,
    now: input.now,
    course: input.course,
    learning: input.learning,
    planning: input.planning,
    generation: input.generation,
  });

  const captureReviewProfileCheckpoint = createReviewProfileCheckpointCapture(input);

  const reviewWriter = createGenerationReviewWriter({
    runtime: input.generation.runtime,
    execution: input.generation.execution,
    providerId: 'current',
  });
  const reviewEvidence = createReviewEvidence(input.learning, input.artifactStore);

  const stageReviews = createStageReviewWorkflow({
    repository: reviewClosureRepositories.stageReviews,
    unitOfWork: input.unitOfWork,
    reviewTask: {
      async submit(reviewInput) {
        return reviewWriter.submit(
          await reviewEvidence.build(
            'stage',
            reviewInput.sessionId,
            reviewInput.sourceSnapshotHash,
          ),
          reviewInput.commandId,
        );
      },
    },
    providerId: 'current',
    now: () => new Date(),
    assertLessonWritable: input.course.access.assertLessonWritable,
    async commitToLearningSession(lessonId, reviewId) {
      const view = await sessionModule.query(
        { type: 'GetLessonLearning', lessonId },
        {
          correlationId: `correlation_${randomUUID()}`,
          actor: 'local-user',
          requestedAt: new Date().toISOString(),
          receivedAt: new Date().toISOString(),
        },
      );
      const record = await input.learning.access.getRecord(lessonId);
      await sessionModule.execute(
        { type: 'CommitStageReview', lessonId, reviewId },
        {
          commandId: `commit_stage_${randomUUID()}`,
          correlationId: `correlation_${randomUUID()}`,
          idempotencyKey: `stage_${reviewId}`,
          actor: 'local-user',
          requestedAt: new Date().toISOString(),
          receivedAt: new Date().toISOString(),
          expectedVersion: view.resourceVersion,
          ...(record?.writeLease === undefined
            ? {}
            : { pageInstanceId: record.writeLease.pageInstanceId }),
        },
      );
    },
  });
  const activeStageReviewFinalizations = new Map<string, Promise<void>>();
  const activeAbandonmentReviewPreparations = new Map<string, Promise<void>>();

  function scheduleStageReviewFinalization(review: {
    readonly lessonId: string;
    readonly reviewId: string;
    readonly taskId: string;
  }): void {
    if (activeStageReviewFinalizations.has(review.taskId)) return;
    const finalization = (async () => {
      try {
        const generated = await reviewWriter.complete(review.taskId);
        const currentReview = await reviewClosureRepositories.stageReviews.get(review.reviewId);
        if (currentReview === undefined) throw new Error('stage_review_not_found');
        const evidence = await reviewEvidence.build(
          'stage',
          currentReview.sourceSessionId,
          currentReview.sourceSnapshotHash,
        );
        const document = reviewEvidence.normalizeRefs(
          generated.document,
          'lesson-stage',
          evidence.checkpoint.sourceMessageIds,
        );
        const markdown = generated.markdown;
        const artifactRef = `lesson_review_${review.reviewId}`;
        await input.artifactStore.finalize({
          artifactId: artifactRef,
          kind: 'lesson-stage-review',
          content: markdown,
          immutable: false,
        });
        await stageReviews.commit({
          reviewId: review.reviewId,
          taskId: review.taskId,
          artifactRef,
          contentSha256: generated.contentSha256,
          ...(document === undefined ? {} : { document }),
        });
        const committedReview = await reviewClosureRepositories.stageReviews.get(review.reviewId);
        const reviewedLesson = await input.course.access.getLesson(review.lessonId);
        if (reviewedLesson !== undefined) {
          await captureReviewProfileCheckpoint({
            checkpointKind: 'stage_review_finalized',
            sourceRef: `review:${review.reviewId}`,
            markdown,
            courseId: reviewedLesson.courseId,
            lessonId: review.lessonId,
            sessionId: currentReview.sourceSessionId,
            observedAt: committedReview?.updatedAt ?? input.now().toISOString(),
          });
        }
      } catch (error) {
        const current = await reviewClosureRepositories.stageReviews.get(review.reviewId);
        if (current?.status !== 'generating' || current.taskId !== review.taskId) return;
        await stageReviews.fail({
          reviewId: review.reviewId,
          taskId: review.taskId,
          errorCode:
            error instanceof Error && error.message.trim() !== ''
              ? error.message.slice(0, 200)
              : 'stage_review_generation_failed',
          draftArtifactRef: current.draftArtifactRef ?? `draft_${review.taskId}`,
        });
      }
    })()
      .catch(() => undefined)
      .finally(() => activeStageReviewFinalizations.delete(review.taskId));
    activeStageReviewFinalizations.set(review.taskId, finalization);
  }

  function scheduleAbandonmentReviewPreparation(request: {
    readonly lessonId: string;
    readonly sessionId: string;
    readonly commandId: string;
  }): void {
    if (activeAbandonmentReviewPreparations.has(request.sessionId)) return;
    const preparation = (async () => {
      const messages = await input.learning.access.listMessages(request.sessionId);
      if (messages.length === 0) return;
      await teachingRuntime.drainObservations(request.sessionId);
      const state = await teachingRuntime.module.getTeachingState(request.sessionId);
      const checkpoint = await teachingRuntime.module.freezeCheckpoint({
        sessionId: request.sessionId,
        reason: state.evidenceCheckpoint ? 'evidenced_abandon' : 'manual_pause',
      });
      await input.learning.access.captureTeachingProfileCheckpoint(checkpoint);
      const stageReview = await stageReviews.request({
        lessonId: request.lessonId,
        sourceSessionId: request.sessionId,
        sourceSnapshotHash: checkpoint.sourceSnapshotHash,
        commandId: request.commandId,
      });
      scheduleStageReviewFinalization({
        lessonId: request.lessonId,
        reviewId: stageReview.reviewId,
        taskId: stageReview.taskId,
      });
    })()
      .catch(() => undefined)
      .finally(() => activeAbandonmentReviewPreparations.delete(request.sessionId));
    activeAbandonmentReviewPreparations.set(request.sessionId, preparation);
  }
  const lessonClosureRepository = reviewClosureRepositories.lessonClosures;
  const lessonClosures = createLessonClosureWorkflow({
    repository: lessonClosureRepository,
    unitOfWork: input.unitOfWork,
    sessionModule,
    reviewTask: {
      async submit(reviewInput) {
        return reviewWriter.submit(
          await reviewEvidence.build(
            'final',
            reviewInput.record.sessionId,
            reviewInput.record.messageRangeChecksum,
          ),
          reviewInput.commandId,
        );
      },
    },
    nextTransactionId: () => `closure_${randomUUID()}`,
    nextReviewId: reviewIdForLesson,
    now: () => new Date(),
    assertLessonWritable: input.course.access.assertLessonWritable,
  });
  const activeLessonClosureFinalizations = new Map<string, Promise<void>>();
  const maxAutomaticClosureAttempts = 5;
  const reconcileIntervalMs = Math.max(10, input.reconcileIntervalMs ?? 15_000);
  let lessonClosureReconcileTimer: ReturnType<typeof setInterval> | undefined;
  let activeLessonClosureScan: Promise<void> | undefined;

  async function prepareLessonClosureSnapshot(
    closure: LessonClosureRecord,
    context: CommandContext,
  ): Promise<LessonClosureRecord> {
    const lesson = await input.course.access.getLesson(closure.lessonId);
    if (lesson === undefined) {
      throw Object.assign(new Error('resource_not_found'), { code: 'resource_not_found' });
    }
    await teachingRuntime.recoverSession({
      courseId: lesson.courseId,
      lessonId: closure.lessonId,
      sessionId: closure.sessionId,
      context,
    });
    await teachingRuntime.drainObservations(closure.sessionId);
    const checkpoint = await teachingRuntime.module.freezeCheckpoint({
      sessionId: closure.sessionId,
      reason: 'lesson_closure',
    });
    if (
      checkpoint.observationCompleteness !== 'complete' ||
      !checkpoint.teachingState.evidenceCheckpoint ||
      checkpoint.retentionDecision !== 'preserve'
    ) {
      throw Object.assign(new Error('projection_incomplete'), {
        code: 'projection_incomplete',
      });
    }
    await input.learning.access.captureTeachingProfileCheckpoint(checkpoint);
    return lessonClosures.replaceSnapshot(closure.transactionId, {
      sourceSessionIds: [closure.sessionId],
      sourceMessageIds: [...checkpoint.sourceMessageIds],
      messageRangeChecksum: checkpoint.sourceSnapshotHash,
    });
  }

  function scheduleLessonClosureFinalization(
    closure: LessonClosureRecord,
    context: CommandContext,
  ): Promise<void> {
    const active = activeLessonClosureFinalizations.get(closure.transactionId);
    if (active !== undefined) return active;
    const finalization = (async () => {
      let stage: LessonClosureWorkflowStage = 'preparing';
      try {
        let current = await lessonClosureRepository.get(closure.transactionId);
        if (current === undefined) throw new Error('lesson_closure_not_found');
        if (current.state === 'generating-failed') {
          const retryIsDue =
            current.nextAttemptAt === undefined ||
            Date.parse(current.nextAttemptAt) <= input.now().getTime();
          if (!retryIsDue || (current.workflowAttempt ?? 0) >= maxAutomaticClosureAttempts) return;
          const previousTask =
            current.generationTaskId === 'pending'
              ? undefined
              : await input.generation.runtime.get(current.generationTaskId).catch(() => undefined);
          if (previousTask?.status !== 'completed') {
            current = await lessonClosures.resetPreparation(current.transactionId, false);
          }
        }
        if (current.state === 'open') {
          stage = 'preparing';
          current = await prepareLessonClosureSnapshot(current, context);
          stage = 'generating';
          current = await lessonClosures.retry(
            current.transactionId,
            `reconcile_${current.transactionId}_${current.workflowAttempt ?? 0}`,
          );
        }
        if (current.state === 'generating' || current.state === 'generating-failed') {
          stage = 'finalizing';
          const generated = await reviewWriter.complete(current.generationTaskId);
          const document = reviewEvidence.normalizeRefs(
            generated.document,
            'lesson-final',
            current.sourceMessageIds,
          );
          const artifactRef = `lesson_review_${reviewIdForLesson(current.lessonId)}_${generated.contentSha256.slice(0, 16)}`;
          await input.artifactStore.finalize({
            artifactId: artifactRef,
            kind: 'lesson-final-review',
            content: generated.markdown,
            immutable: true,
          });
          current = await lessonClosures.markReviewReady(current.transactionId, {
            artifactRef,
            markdown: generated.markdown,
            sourceSessionIds: current.sourceSessionIds,
            messageRangeChecksum: current.messageRangeChecksum,
            contentSha256: generated.contentSha256,
            ...(document === undefined ? {} : { document }),
          });
        }
        stage = 'committing';
        const committed =
          current.state === 'committing'
            ? await lessonClosures.recover(
                current.transactionId,
                current.messageRangeChecksum,
                context,
              )
            : current.state === 'review-ready'
              ? await lessonClosures.commit(
                  current.transactionId,
                  current.messageRangeChecksum,
                  context,
                )
              : current;
        if (committed.state !== 'completed' || committed.review === undefined) return;
        stage = 'post-commit';
        const lesson = await input.course.access.getLesson(committed.lessonId);
        if (lesson === undefined) return;
        await captureReviewProfileCheckpoint({
          checkpointKind: 'lesson_review_finalized',
          sourceRef: `review:${reviewIdForLesson(committed.lessonId)}`,
          markdown: committed.review.markdown,
          courseId: lesson.courseId,
          lessonId: committed.lessonId,
          sessionId: committed.sessionId,
          observedAt: committed.updatedAt,
        });
        await refreshNextLessonRecommendation(lesson.courseId, 'lesson-completed', lesson.id);
        courseReviewRuntime.triggerPregeneration(lesson.courseId);
        if (
          committed.failureStage !== undefined ||
          committed.errorCode !== undefined ||
          (committed.workflowAttempt ?? 0) > 0
        ) {
          await lessonClosures.clearFailure(committed.transactionId);
        }
      } catch (error) {
        const current = await lessonClosureRepository.get(closure.transactionId);
        if (current === undefined || current.state === 'cancelled') return;
        const errorCode =
          error instanceof Error && error.message.trim() !== ''
            ? error.message.slice(0, 200)
            : 'lesson_review_generation_failed';
        const attempt = (current.workflowAttempt ?? 0) + 1;
        const retryDelayMs = Math.min(60_000, 1_000 * 2 ** Math.max(0, attempt - 1));
        const nextAttemptAt = new Date(input.now().getTime() + retryDelayMs).toISOString();
        if (
          current.state === 'open' ||
          current.state === 'generating' ||
          current.state === 'generating-failed'
        ) {
          await lessonClosures.fail(
            current.transactionId,
            errorCode,
            current.draftArtifactRef ?? `draft_${current.generationTaskId}`,
            { stage, nextAttemptAt },
          );
          return;
        }
        await lessonClosures.defer(current.transactionId, {
          stage,
          errorCode,
          nextAttemptAt,
        });
      }
    })().finally(() => activeLessonClosureFinalizations.delete(closure.transactionId));
    activeLessonClosureFinalizations.set(closure.transactionId, finalization);
    return finalization;
  }
  const courseReviewRuntime = createLocalCourseReviewRuntime({
    repositories: reviewClosureRepositories,
    unitOfWork: input.unitOfWork,
    artifactStore: input.artifactStore,
    course: input.course,
    learning: input.learning,
    events: input.events,
    reviewWriter,
    normalizeEvidenceRefs: reviewEvidence.normalizeAllowedRefs,
  });
  const courseReviews = courseReviewRuntime.reviews;

  const routes: ReviewClosureRouteOptions = {
    services: {
      async abandonLesson(lessonId, _sourceSnapshotHash, context) {
        const abandoned = await sessionModule.execute({ type: 'AbandonLesson', lessonId }, context);
        if (abandoned.value.progress !== 'abandoned' || abandoned.value.sessionId === undefined) {
          return abandoned.value;
        }
        scheduleAbandonmentReviewPreparation({
          lessonId,
          sessionId: abandoned.value.sessionId,
          commandId: context.commandId,
        });
        return { ...abandoned.value, reviewStatus: 'generating' as const };
      },
      restoreLesson: (lessonId, context) =>
        sessionModule
          .execute({ type: 'RestoreLesson', lessonId }, context)
          .then((result) => result.value),
      async beginLessonClosure(lessonId, body, context) {
        const current = await input.learning.access.getRecord(lessonId);
        const sessionId = current?.learning.session?.id;
        if (current === undefined || sessionId === undefined || sessionId !== body.sessionId) {
          throw Object.assign(new Error('resource_not_found'), { code: 'resource_not_found' });
        }
        const lesson = await input.course.access.getLesson(lessonId);
        if (lesson === undefined) {
          throw Object.assign(new Error('resource_not_found'), { code: 'resource_not_found' });
        }
        const sourceMessageIds = (await input.learning.access.listMessages(sessionId))
          .filter((message) => message.completionStatus !== 'interrupted')
          .map((message) => message.id);
        const provisionalSnapshotHash = createHash('sha256')
          .update(JSON.stringify({ sessionId, sourceMessageIds }))
          .digest('hex');
        let closure = await lessonClosures.begin({
          lessonId,
          sessionId,
          sourceSessionIds: [sessionId],
          sourceMessageIds,
          messageRangeChecksum: provisionalSnapshotHash,
          endIntent: body.endIntent,
          expectedSessionVersion: current.resourceVersion,
        });
        if (closure.state === 'open') {
          closure = await prepareLessonClosureSnapshot(closure, context);
          closure = await lessonClosures.retry(
            closure.transactionId,
            `initial_${closure.transactionId}`,
          );
        }
        const completed = await sessionModule.execute(
          { type: 'CompleteLessonPendingReview', lessonId },
          {
            ...context,
            commandId: `complete_pending_review_${closure.transactionId}`,
            idempotencyKey: `complete_pending_review_${closure.transactionId}`,
            expectedVersion: current.resourceVersion,
          },
        );
        void scheduleLessonClosureFinalization(closure, context);
        return {
          ...closure,
          progress: 'completed' as const,
          resourceVersion: completed.value.resourceVersion,
        };
      },
      async closeCourse(courseId, confirmAbandoned, context) {
        const course = await input.course.access.getCourse(courseId);
        if (course === undefined) {
          throw Object.assign(new Error('not found'), { code: 'resource_not_found' });
        }
        const inputManifest = await courseReviewRuntime.buildInputManifest(courseId);
        const closed = await closeCourseAggregate(
          {
            courseId,
            expectedVersion: context.expectedVersion ?? course.resourceVersion,
            confirmAbandoned,
            idempotencyKey: context.idempotencyKey,
          },
          {
            repositories: input.course.courseRepositories,
            unitOfWork: input.unitOfWork,
            getLessonState: async (lessonId) =>
              (await input.learning.access.getRecord(lessonId))?.learning.progress ?? 'not_started',
            inputManifest,
            outbox: input.events.outbox,
            now: () => new Date(),
            nextEventId: () => `event_${randomUUID()}`,
          },
        );
        const existingReview = await reviewClosureRepositories.courseReviews.get(courseId);
        if (existingReview?.state === 'review-finalized') {
          const markdown =
            existingReview.artifactRef === undefined
              ? undefined
              : (await input.artifactStore.read(existingReview.artifactRef))?.content;
          return {
            ...existingReview,
            ...(markdown === undefined ? {} : { markdown }),
            ...(existingReview.document === undefined ? {} : { document: existingReview.document }),
            transactionId: courseId,
            resourceVersion: closed.resourceVersion,
          };
        }
        const review = await courseReviews.request(courseId, inputManifest, context.commandId);
        void courseReviewRuntime.scheduleFinalization(courseId);
        return {
          ...review,
          transactionId: courseId,
          resourceVersion: closed.resourceVersion,
        };
      },
      async getClosure(transactionId) {
        const closure = await lessonClosureRepository.get(transactionId);
        if (closure === undefined) {
          throw Object.assign(new Error('not found'), { code: 'resource_not_found' });
        }
        return closure;
      },
      async retryClosure(transactionId, context) {
        const reopened = await lessonClosures.resetPreparation(transactionId);
        if (reopened.state === 'open') {
          void scheduleLessonClosureFinalization(reopened, context);
          return reopened;
        }
        const retried = await lessonClosures.retry(transactionId, context.commandId);
        void scheduleLessonClosureFinalization(retried, context);
        return retried;
      },
      async getCourseReview(courseId) {
        const review = await reviewClosureRepositories.courseReviews.get(courseId);
        if (review === undefined) return undefined;
        const markdown =
          review.artifactRef === undefined
            ? undefined
            : (await input.artifactStore.read(review.artifactRef))?.content;
        return {
          ...review,
          ...(markdown === undefined ? {} : { markdown }),
          ...(review.document === undefined ? {} : { document: review.document }),
        };
      },
    },
    nextCommandId: () => `command_${randomUUID()}`,
    nextCorrelationId: () => `correlation_${randomUUID()}`,
    now: () => new Date(),
  };

  function closureRetryIsDue(closure: LessonClosureRecord): boolean {
    return (
      closure.nextAttemptAt === undefined ||
      Date.parse(closure.nextAttemptAt) <= input.now().getTime()
    );
  }

  function recoveryContextFor(
    closure: LessonClosureRecord,
    learning: Awaited<ReturnType<typeof input.learning.access.getRecord>>,
  ): CommandContext {
    const recoveredAt = input.now().toISOString();
    return {
      commandId: `recover_${closure.transactionId}`,
      correlationId: `recover_${closure.transactionId}`,
      idempotencyKey: `recover_${closure.transactionId}`,
      actor: 'local-user',
      requestedAt: recoveredAt,
      receivedAt: recoveredAt,
      ...(learning === undefined ? {} : { expectedVersion: learning.resourceVersion }),
      ...(learning?.writeLease?.pageInstanceId === undefined
        ? {}
        : { pageInstanceId: learning.writeLease.pageInstanceId }),
    };
  }

  function reconcilePersistedLessonClosures(): Promise<void> {
    if (activeLessonClosureScan !== undefined) return activeLessonClosureScan;
    const scan = (async () => {
      const recoverableClosures: LessonClosureRecord[] = [];
      for await (const closure of lessonClosureRepository.list()) {
        const activeState = ['open', 'generating', 'review-ready', 'committing'].includes(
          closure.state,
        );
        const retryableFailure =
          closure.state === 'generating-failed' &&
          (closure.workflowAttempt ?? 0) < maxAutomaticClosureAttempts;
        const pendingPostCommit =
          closure.state === 'completed' && closure.failureStage === 'post-commit';
        if (!activeState && !retryableFailure && !pendingPostCommit) continue;
        if (!closureRetryIsDue(closure)) continue;
        recoverableClosures.push(closure);
      }
      const recoveryRank: Readonly<Record<LessonClosureRecord['state'], number>> = {
        open: 1,
        generating: 2,
        'generating-failed': 0,
        'review-ready': 3,
        committing: 4,
        completed: 5,
        cancelled: -1,
      };
      recoverableClosures.sort(
        (left, right) =>
          recoveryRank[right.state] - recoveryRank[left.state] ||
          right.updatedAt.localeCompare(left.updatedAt),
      );
      const selectedClosureSnapshots = new Set<string>();
      for (const closure of recoverableClosures) {
        const snapshotKey = `${closure.lessonId}:${closure.sessionId}:${closure.messageRangeChecksum}`;
        if (closure.state !== 'completed' && selectedClosureSnapshots.has(snapshotKey)) {
          if (closure.state !== 'committing') await lessonClosures.cancel(closure.transactionId);
          continue;
        }
        selectedClosureSnapshots.add(snapshotKey);
        const learning = await input.learning.access.getRecord(closure.lessonId);
        if (learning === undefined && closure.state !== 'completed') continue;
        const context = recoveryContextFor(closure, learning);
        if (learning?.learning.progress === 'in_progress') {
          await sessionModule.execute(
            { type: 'CompleteLessonPendingReview', lessonId: closure.lessonId },
            {
              ...context,
              commandId: `complete_pending_review_${closure.transactionId}`,
              idempotencyKey: `complete_pending_review_${closure.transactionId}`,
            },
          );
        }
        void scheduleLessonClosureFinalization(closure, context).catch(() => undefined);
      }
    })().finally(() => {
      activeLessonClosureScan = undefined;
    });
    activeLessonClosureScan = scan;
    return scan;
  }

  function startLessonClosureReconciler(): void {
    if (lessonClosureReconcileTimer !== undefined) return;
    lessonClosureReconcileTimer = setInterval(() => {
      void reconcilePersistedLessonClosures().catch(() => undefined);
    }, reconcileIntervalMs);
    lessonClosureReconcileTimer.unref();
  }

  return {
    routes,
    async recoverProfileCheckpoints() {
      const checkpoints = await collectRecoverableReviewProfileCheckpoints({
        stageReviews: reviewClosureRepositories.stageReviews.list(),
        lessonClosures: reviewClosureRepositories.lessonClosures.list(),
        readArtifact: (artifactId) => input.artifactStore.read(artifactId),
        getCourseIdForLesson: async (lessonId) =>
          (await input.course.access.getLesson(lessonId))?.courseId,
      });
      for (const checkpoint of checkpoints) {
        await captureReviewProfileCheckpoint(checkpoint, { refreshReasoningAnalysis: false });
      }
    },
    async recoverCommittingClosures() {
      await lessonClosureRepository.initialize();
      for await (const review of reviewClosureRepositories.stageReviews.list()) {
        if (review.status !== 'generating') continue;
        scheduleStageReviewFinalization({
          lessonId: review.lessonId,
          reviewId: review.reviewId,
          taskId: review.taskId,
        });
      }
      await reconcilePersistedLessonClosures();
      startLessonClosureReconciler();
      for await (const review of reviewClosureRepositories.courseReviews.list()) {
        if (review.state === 'generating-review' || review.state === 'review-ready') {
          void courseReviewRuntime.scheduleFinalization(review.courseId);
        }
      }
      for await (const course of input.course.access.listCourses()) {
        courseReviewRuntime.triggerPregeneration(course.id);
      }
    },
    async close() {
      if (lessonClosureReconcileTimer !== undefined) {
        clearInterval(lessonClosureReconcileTimer);
        lessonClosureReconcileTimer = undefined;
      }
      await activeLessonClosureScan;
      await Promise.allSettled([
        ...activeLessonClosureFinalizations.values(),
        ...activeStageReviewFinalizations.values(),
        ...activeAbandonmentReviewPreparations.values(),
      ]);
    },
  };
}
