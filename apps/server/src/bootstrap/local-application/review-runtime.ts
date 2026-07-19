import { randomUUID } from 'node:crypto';

import type { CommandContext } from '@learning-more/contracts';

import type { ReviewClosureRouteOptions } from '../../http/routes/review-closure.js';
import { closeCourse as closeCourseAggregate } from '../../modules/course-authoring/implementation/close-course.js';
import { createGenerationReviewWriter } from '../../modules/review-closure/implementation/generation-review-writer.js';
import { createLessonClosureWorkflow } from '../../modules/review-closure/implementation/lesson-closure.js';
import type { LessonClosureRecord } from '../../modules/review-closure/model/review-state.js';
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
  }>,
): LocalReviewRuntime {
  const reviewClosureRepositories = createLocalFileReviewClosureRepositories(input.dataRoot);
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
  const reviewEvidence = createReviewEvidence(input.learning);

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
        reviewEvidence.assertRefs(
          generated.document,
          'lesson-stage',
          new Set(evidence.checkpoint.sourceMessageIds.map((id) => `message:${id}`)),
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
          ...(generated.document === undefined ? {} : { document: generated.document }),
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

  function scheduleLessonClosureFinalization(
    closure: LessonClosureRecord,
    context: CommandContext,
  ): Promise<void> {
    const active = activeLessonClosureFinalizations.get(closure.transactionId);
    if (active !== undefined) return active;
    const finalization = (async () => {
      try {
        let current = await lessonClosureRepository.get(closure.transactionId);
        if (current === undefined) throw new Error('lesson_closure_not_found');
        if (current.state === 'open') {
          current = await lessonClosures.retry(
            current.transactionId,
            `initial_${current.transactionId}`,
          );
        }
        if (current.state === 'generating') {
          const generated = await reviewWriter.complete(current.generationTaskId);
          reviewEvidence.assertRefs(
            generated.document,
            'lesson-final',
            new Set(current.sourceMessageIds.map((id) => `message:${id}`)),
          );
          const artifactRef = `lesson_review_${reviewIdForLesson(current.lessonId)}`;
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
            ...(generated.document === undefined ? {} : { document: generated.document }),
          });
        }
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
      } catch (error) {
        const current = await lessonClosureRepository.get(closure.transactionId);
        if (current?.state !== 'open' && current?.state !== 'generating') return;
        await lessonClosures.fail(
          current.transactionId,
          error instanceof Error && error.message.trim() !== ''
            ? error.message.slice(0, 200)
            : 'lesson_review_generation_failed',
          current.draftArtifactRef ?? `draft_${current.generationTaskId}`,
        );
      }
    })()
      .catch(() => undefined)
      .finally(() => activeLessonClosureFinalizations.delete(closure.transactionId));
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
    assertEvidenceRefs: reviewEvidence.assertRefs,
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
        await teachingRuntime.recoverSession({
          courseId: lesson.courseId,
          lessonId,
          sessionId,
          context,
        });
        await teachingRuntime.drainObservations(sessionId);
        const checkpoint = await teachingRuntime.module.freezeCheckpoint({
          sessionId,
          reason: 'lesson_closure',
        });
        if (
          checkpoint.teachingState.lessonPhase !== undefined &&
          checkpoint.teachingState.lessonPhase !== 'ready_to_close'
        ) {
          throw Object.assign(new Error('lesson_not_completable'), {
            code: 'lesson_not_completable',
          });
        }
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
        const closure = await lessonClosures.begin({
          lessonId,
          sessionId,
          sourceSessionIds: [sessionId],
          sourceMessageIds: [...checkpoint.sourceMessageIds],
          messageRangeChecksum: checkpoint.sourceSnapshotHash,
          endIntent: body.endIntent,
          expectedSessionVersion: current.resourceVersion,
        });
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
      for await (const review of reviewClosureRepositories.stageReviews.list()) {
        if (review.status !== 'generating') continue;
        scheduleStageReviewFinalization({
          lessonId: review.lessonId,
          reviewId: review.reviewId,
          taskId: review.taskId,
        });
      }
      const recoverableClosures: LessonClosureRecord[] = [];
      for await (const closure of lessonClosureRepository.list()) {
        if (!['open', 'generating', 'review-ready', 'committing'].includes(closure.state)) continue;
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
        if (selectedClosureSnapshots.has(snapshotKey)) {
          await lessonClosures.cancel(closure.transactionId);
          continue;
        }
        selectedClosureSnapshots.add(snapshotKey);
        const learning = await input.learning.access.getRecord(closure.lessonId);
        const pageInstanceId = learning?.writeLease?.pageInstanceId;
        if (learning === undefined || pageInstanceId === undefined) {
          throw new Error(`LESSON_CLOSURE_RECOVERY_CONTEXT_MISSING:${closure.transactionId}`);
        }
        const recoveredAt = new Date().toISOString();
        const recoveryContext: CommandContext = {
          commandId: `recover_${closure.transactionId}`,
          correlationId: `recover_${closure.transactionId}`,
          idempotencyKey: `recover_${closure.transactionId}`,
          actor: 'local-user',
          requestedAt: recoveredAt,
          receivedAt: recoveredAt,
          expectedVersion: learning.resourceVersion,
          pageInstanceId,
        };
        if (learning.learning.progress === 'in_progress') {
          await sessionModule.execute(
            { type: 'CompleteLessonPendingReview', lessonId: closure.lessonId },
            {
              ...recoveryContext,
              commandId: `complete_pending_review_${closure.transactionId}`,
              idempotencyKey: `complete_pending_review_${closure.transactionId}`,
            },
          );
        }
        if (closure.state === 'committing') {
          await lessonClosures.recover(
            closure.transactionId,
            closure.messageRangeChecksum,
            recoveryContext,
          );
          continue;
        }
        void scheduleLessonClosureFinalization(closure, recoveryContext);
      }
      for await (const review of reviewClosureRepositories.courseReviews.list()) {
        if (review.state === 'generating-review' || review.state === 'review-ready') {
          void courseReviewRuntime.scheduleFinalization(review.courseId);
        }
      }
      for await (const course of input.course.access.listCourses()) {
        courseReviewRuntime.triggerPregeneration(course.id);
      }
    },
  };
}
