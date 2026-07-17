import { randomUUID } from 'node:crypto';

import type { CommandContext, ProfileEvidenceCheckpointKind } from '@learning-more/contracts';

import type { ReviewClosureRouteOptions } from '../../http/routes/review-closure.js';
import { closeCourse as closeCourseAggregate } from '../../modules/course-authoring/implementation/close-course.js';
import { teachingPlayIntent } from '../../modules/interactive-teaching/implementation/teaching-play-intent.js';
import { abandonLesson } from '../../modules/learning-session/implementation/abandon-lesson.js';
import { createCourseReviewWorkflow } from '../../modules/review-closure/implementation/course-review.js';
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

export type LocalReviewRuntime = Readonly<{
  routes: ReviewClosureRouteOptions;
  recoverCommittingClosures(): Promise<void>;
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
  const teachingContextSources = input.learning.access.teachingContextSources;
  const refreshNextLessonRecommendation = createNextLessonRefresh({
    unitOfWork: input.unitOfWork,
    artifactStore: input.artifactStore,
    now: input.now,
    course: input.course,
    learning: input.learning,
    planning: input.planning,
    generation: input.generation,
  });

  async function captureReviewProfileCheckpoint(checkpointInput: {
    checkpointKind: Extract<
      ProfileEvidenceCheckpointKind,
      'stage_review_finalized' | 'lesson_review_finalized' | 'course_review_finalized'
    >;
    sourceRef: string;
    markdown: string;
    courseId: string;
    lessonId?: string;
    observedAt: string;
  }): Promise<void> {
    if (checkpointInput.markdown.trim() === '') return;
    const sourceGroupId = `review:${checkpointInput.sourceRef}`;
    const [course, lesson] = await Promise.all([
      input.course.access.getCourse(checkpointInput.courseId),
      checkpointInput.lessonId === undefined
        ? Promise.resolve(undefined)
        : input.course.access.getLesson(checkpointInput.lessonId),
    ]);
    const dependentSourceGroupIds: string[] = [];
    if (checkpointInput.lessonId !== undefined) {
      const learning = await input.learning.access.getRecord(checkpointInput.lessonId);
      if (learning?.learning.session?.id !== undefined) {
        dependentSourceGroupIds.push(
          `lesson:${checkpointInput.lessonId}:session:${learning.learning.session.id}`,
        );
      }
    } else if (course !== undefined) {
      for (const lessonId of course.lessonIds) {
        const learning = await input.learning.access.getRecord(lessonId);
        if (learning?.finalReview !== undefined) {
          dependentSourceGroupIds.push(`review:review:${learning.finalReview.id}`);
        }
      }
    }
    input.profile.checkpointSink.capture({
      checkpointId: `profile:${checkpointInput.sourceRef}:${checkpointInput.checkpointKind}`,
      checkpointKind: checkpointInput.checkpointKind,
      sourceType: 'review',
      sourceGroupId,
      dependentSourceGroupIds,
      ...(course === undefined ? {} : { courseContext: course.title }),
      ...(lesson === undefined ? {} : { lessonContext: `${lesson.title}｜${lesson.objective}` }),
      completeness: 'complete',
      sources: [
        {
          sourceRef: checkpointInput.sourceRef,
          sourceGroupId,
          sourceType: 'review',
          role: 'review',
          excerpt: checkpointInput.markdown,
          observedAt: checkpointInput.observedAt,
        },
      ],
    });
  }

  const reviewWriter = createGenerationReviewWriter({
    runtime: input.generation.runtime,
    execution: input.generation.execution,
    providerId: 'current',
  });
  async function buildReviewEvidencePack(
    kind: 'stage' | 'final',
    sessionId: string,
    sourceSnapshotHash: string,
  ) {
    const ledger = await input.learning.access.getTeachingLedger(sessionId);
    if (ledger === undefined) throw new Error('review_teaching_ledger_not_found');
    const checkpoint = [...ledger.checkpoints]
      .reverse()
      .find((candidate) => candidate.sourceSnapshotHash === sourceSnapshotHash);
    if (checkpoint === undefined) throw new Error('review_checkpoint_not_found');
    const facts = await teachingContextSources.getCourseAndLesson({
      courseId: ledger.courseId,
      lessonId: ledger.lessonId,
    });
    const messages = await teachingContextSources.listMessages(sessionId);
    const observationIds = new Set(
      checkpoint.observationRefs.map((ref) => ref.replace(/^observation:/u, '')),
    );
    return {
      kind,
      checkpoint,
      course: { courseId: facts.course.courseId, title: facts.course.title },
      lesson: {
        lessonId: facts.lesson.lessonId,
        title: facts.lesson.title,
        objective: facts.lesson.objective,
        coreKnowledgePoints: facts.lesson.coreKnowledgePoints.map((point) => point.text),
      },
      observations: ledger.observations.filter((observation) =>
        observationIds.has(observation.observationId),
      ),
      messages: messages.filter((message) =>
        checkpoint.sourceMessageIds.includes(message.messageId),
      ),
      ...(facts.course.playIntent === undefined ? {} : { reviewLens: facts.course.playIntent }),
    } as const;
  }

  const stageReviews = createStageReviewWorkflow({
    repository: reviewClosureRepositories.stageReviews,
    unitOfWork: input.unitOfWork,
    reviewTask: {
      async submit(reviewInput) {
        return reviewWriter.submit(
          await buildReviewEvidencePack(
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

  function scheduleStageReviewFinalization(review: {
    readonly lessonId: string;
    readonly reviewId: string;
    readonly taskId: string;
  }): void {
    if (activeStageReviewFinalizations.has(review.taskId)) return;
    const finalization = (async () => {
      try {
        const generated = await reviewWriter.complete(review.taskId);
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
        });
        const reviewedLesson = await input.course.access.getLesson(review.lessonId);
        if (reviewedLesson !== undefined) {
          await captureReviewProfileCheckpoint({
            checkpointKind: 'stage_review_finalized',
            sourceRef: `review:${review.reviewId}`,
            markdown,
            courseId: reviewedLesson.courseId,
            lessonId: review.lessonId,
            observedAt: input.now().toISOString(),
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
  const lessonClosureRepository = reviewClosureRepositories.lessonClosures;
  const lessonClosures = createLessonClosureWorkflow({
    repository: lessonClosureRepository,
    unitOfWork: input.unitOfWork,
    sessionModule,
    reviewTask: {
      async submit(reviewInput) {
        return reviewWriter.submit(
          await buildReviewEvidencePack(
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
        if (current.state === 'generating') {
          const generated = await reviewWriter.complete(current.generationTaskId);
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
          observedAt: input.now().toISOString(),
        });
        await refreshNextLessonRecommendation(lesson.courseId, 'lesson-completed', lesson.id);
      } catch (error) {
        const current = await lessonClosureRepository.get(closure.transactionId);
        if (current?.state !== 'generating') return;
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
  const courseReviews = createCourseReviewWorkflow({
    repository: reviewClosureRepositories.courseReviews,
    unitOfWork: input.unitOfWork,
    reviewTask: {
      async submit(reviewInput) {
        const course = await input.course.access.getCourse(reviewInput.courseId);
        if (course === undefined) throw new Error('course_review_course_not_found');
        const lessons = [];
        const finalReviewLessonByRef = new Map<string, string>();
        for await (const lesson of input.course.access.listLessons(reviewInput.courseId)) {
          lessons.push({
            lessonId: lesson.id,
            title: lesson.title,
            objective: lesson.objective,
            coreKnowledgePoints: lesson.coreKnowledgePoints,
          });
          const learning = await input.learning.access.getRecord(lesson.id);
          if (learning?.finalReview !== undefined) {
            finalReviewLessonByRef.set(learning.finalReview.artifactRef, lesson.id);
          }
        }
        const lessonReviews = [];
        for (const sourceRef of reviewInput.inputManifest.completedFinalReviewRefs) {
          const lessonId = finalReviewLessonByRef.get(sourceRef);
          const markdown = (await input.artifactStore.read(sourceRef))?.content;
          if (lessonId === undefined || markdown === undefined) {
            throw new Error('course_review_evidence_pack_incomplete');
          }
          lessonReviews.push({ lessonId, kind: 'final' as const, sourceRef, markdown });
        }
        for (const reviewId of reviewInput.inputManifest.abandonedStageReviewRefs) {
          const stageReview = await reviewClosureRepositories.stageReviews.get(reviewId);
          const artifactRef = stageReview?.artifactRef;
          const markdown =
            artifactRef === undefined
              ? undefined
              : (await input.artifactStore.read(artifactRef))?.content;
          if (stageReview === undefined || artifactRef === undefined || markdown === undefined) {
            throw new Error('course_review_evidence_pack_incomplete');
          }
          lessonReviews.push({
            lessonId: stageReview.lessonId,
            kind: 'stage' as const,
            sourceRef: artifactRef,
            markdown,
          });
        }
        const playIntent = teachingPlayIntent(course.courseMode);
        return reviewWriter.submitCourse(
          {
            kind: 'course',
            course: {
              courseId: course.id,
              title: course.title,
              outlineVersionId: reviewInput.inputManifest.outlineVersionId,
            },
            lessons,
            lessonReviews,
            abandonedWithoutReviewLessonIds:
              reviewInput.inputManifest.abandonedWithoutReviewLessonIds,
            ...(playIntent === undefined ? {} : { reviewLens: playIntent }),
          },
          reviewInput.commandId,
        );
      },
    },
    outbox: input.events.outbox,
    nextEventId: () => `event_${randomUUID()}`,
    now: () => new Date(),
    assertCourseWritable: input.course.access.assertCourseWritable,
  });

  const routes: ReviewClosureRouteOptions = {
    services: {
      async abandonLesson(lessonId, _sourceSnapshotHash, context) {
        const before = await input.learning.access.getRecord(lessonId);
        const sessionId = before?.learning.session?.id;
        let checkpointSourceHash = '0'.repeat(64);
        if (
          sessionId !== undefined &&
          (await input.learning.access.listMessages(sessionId)).length > 0
        ) {
          await teachingRuntime.drainObservations(sessionId);
          const state = await teachingRuntime.module.getTeachingState(sessionId);
          const checkpoint = await teachingRuntime.module.freezeCheckpoint({
            sessionId,
            reason: state.evidenceCheckpoint ? 'evidenced_abandon' : 'manual_pause',
          });
          await input.learning.access.captureTeachingProfileCheckpoint(checkpoint);
          await input.profile.recoverReasoningAnalysis();
          checkpointSourceHash = checkpoint.sourceSnapshotHash;
        }
        const result = await abandonLesson(
          { lessonId, sourceSnapshotHash: checkpointSourceHash },
          context,
          { sessionModule, stageReviews },
        );
        if (result.stageReview === undefined) return result;
        scheduleStageReviewFinalization({
          lessonId,
          reviewId: result.stageReview.reviewId,
          taskId: result.stageReview.taskId,
        });
        return { ...result, reviewStatus: 'generating' as const };
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
        await input.profile.recoverReasoningAnalysis();
        const closure = await lessonClosures.begin({
          lessonId,
          sessionId,
          sourceSessionIds: [sessionId],
          sourceMessageIds: [...checkpoint.sourceMessageIds],
          messageRangeChecksum: checkpoint.sourceSnapshotHash,
          endIntent: body.endIntent,
          expectedSessionVersion: current.resourceVersion,
        });
        void scheduleLessonClosureFinalization(closure, context);
        return closure;
      },
      async closeCourse(courseId, confirmAbandoned, context) {
        const course = await input.course.access.getCourse(courseId);
        if (course === undefined) {
          throw Object.assign(new Error('not found'), { code: 'resource_not_found' });
        }
        const completedFinalReviewRefs: string[] = [];
        const abandonedStageReviewRefs: string[] = [];
        const abandonedWithoutReviewLessonIds: string[] = [];
        for (const lessonId of course.lessonIds) {
          const record = await input.learning.access.getRecord(lessonId);
          if (record?.finalReview !== undefined) {
            completedFinalReviewRefs.push(record.finalReview.artifactRef);
          } else if (
            record?.learning.progress === 'abandoned' &&
            record.learning.session?.stageReviewId !== undefined
          ) {
            abandonedStageReviewRefs.push(record.learning.session.stageReviewId);
          } else if (record?.learning.progress === 'abandoned') {
            abandonedWithoutReviewLessonIds.push(lessonId);
          }
        }
        const inputManifest = {
          outlineVersionId: course.outlineVersionId,
          completedFinalReviewRefs,
          abandonedStageReviewRefs,
          abandonedWithoutReviewLessonIds,
        };
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
            transactionId: courseId,
            resourceVersion: closed.resourceVersion,
          };
        }
        const pendingReview = await courseReviews.request(
          courseId,
          inputManifest,
          context.commandId,
        );
        if (pendingReview.generationTaskId === undefined) {
          throw new Error('course_review_generation_task_missing');
        }
        const generatedCourseReview = await reviewWriter.complete(pendingReview.generationTaskId);
        const courseReviewArtifactRef = `course_review_${courseId}`;
        const courseReviewMarkdown = generatedCourseReview.markdown;
        await input.artifactStore.finalize({
          artifactId: courseReviewArtifactRef,
          kind: 'course-review',
          content: courseReviewMarkdown,
          immutable: true,
        });
        await courseReviews.markReady(
          courseId,
          courseReviewArtifactRef,
          generatedCourseReview.contentSha256,
        );
        const review = await courseReviews.finalize(courseId, context.idempotencyKey);
        await captureReviewProfileCheckpoint({
          checkpointKind: 'course_review_finalized',
          sourceRef: `course-review:${courseId}`,
          markdown: courseReviewMarkdown,
          courseId,
          observedAt: input.now().toISOString(),
        });
        return {
          ...review,
          markdown: courseReviewMarkdown,
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
        return { ...review, ...(markdown === undefined ? {} : { markdown }) };
      },
    },
    nextCommandId: () => `command_${randomUUID()}`,
    nextCorrelationId: () => `correlation_${randomUUID()}`,
    now: () => new Date(),
  };

  return {
    routes,
    async recoverCommittingClosures() {
      for await (const review of reviewClosureRepositories.stageReviews.list()) {
        if (review.status !== 'generating') continue;
        scheduleStageReviewFinalization({
          lessonId: review.lessonId,
          reviewId: review.reviewId,
          taskId: review.taskId,
        });
      }
      for await (const closure of lessonClosureRepository.list()) {
        if (!['generating', 'review-ready', 'committing'].includes(closure.state)) continue;
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
        if (closure.state === 'committing') {
          await lessonClosures.recover(
            closure.transactionId,
            closure.messageRangeChecksum,
            recoveryContext,
          );
          continue;
        }
        await scheduleLessonClosureFinalization(closure, recoveryContext);
      }
    },
  };
}
