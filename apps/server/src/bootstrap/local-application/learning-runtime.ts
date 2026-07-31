import { randomUUID } from 'node:crypto';

import {
  type LearningEventEnvelope,
  type TeachingCheckpointSnapshot,
  type TeachingStateSnapshot,
} from '@learning-more/contracts';

import type { LearningSessionRouteOptions } from '../../http/routes/learning-sessions.js';
import { teachingWeightStatus } from '../../modules/course-authoring/implementation/teaching-weight-service.js';
import { createTeachingContextAssembler } from '../../modules/interactive-teaching/implementation/context-assembler.js';
import { createGenerationTeachingAgent } from '../../modules/interactive-teaching/implementation/generation-teaching-agent.js';
import { createGenerationTeachingObserver } from '../../modules/interactive-teaching/implementation/generation-teaching-observer.js';
import { emphasisFor } from '../../modules/interactive-teaching/implementation/teaching-depth-policy.js';
import { createInteractiveTeaching } from '../../modules/interactive-teaching/implementation/interactive-teaching.js';
import type { TeachingContextSources } from '../../modules/interactive-teaching/ports/teaching-context-sources.js';
import { collapseRetryDuplicateUserMessages } from '../../modules/learning-session/implementation/effective-message-projection.js';
import { createLocalFileMessageLog } from '../../modules/learning-session/implementation/message-log.js';
import { createSessionModule } from '../../modules/learning-session/implementation/session-module.js';
import { createSupplementarySessionModule } from '../../modules/learning-session/implementation/supplementary-session-module.js';
import { createSupplementaryLearning } from '../../modules/learning-session/implementation/supplementary-learning.js';
import { actualLearningSeconds } from '../../modules/learning-session/implementation/time-intervals.js';
import { reviewIdForLesson } from '../../modules/review-closure/implementation/stage-review.js';
import type { LessonClosureRecord } from '../../modules/review-closure/model/review-state.js';
import type { DataRoot } from '../../persistence/data-root.js';
import { createLocalFileLearningSessionRepositories } from '../../persistence/learning-session-repositories.js';
import { createMarkdownArtifactStore } from '../../persistence/markdown-artifact-store.js';
import { createLocalFileReviewClosureRepositories } from '../../persistence/review-closure-repositories.js';
import { createLocalFileSupplementarySessionRepository } from '../../persistence/supplementary-session-repository.js';
import { createLocalFileTeachingLedgerRepository } from '../../persistence/teaching-ledger-repositories.js';
import type { UnitOfWork } from '../../persistence/unit-of-work.js';
import type { StructuredLogInput } from '../../runtime/logger.js';
import type { LocalCourseRuntime } from './course-runtime.js';
import type { LocalEventFactsRuntime } from './event-facts-runtime.js';
import type { LocalGenerationRuntime } from './generation-runtime.js';
import { createLearningInteractionFactSink } from './learning-interaction-facts.js';
import { createLearningTeachingContext } from './learning-teaching-context.js';
import type { LocalProfileRuntime } from './profile-runtime.js';
import { isTeachingSessionRecoveryEligible } from './teaching-session-recovery-policy.js';

type LearningRepositories = ReturnType<typeof createLocalFileLearningSessionRepositories>;
type MessageLog = ReturnType<typeof createLocalFileMessageLog>;
type TeachingLedgerRepository = ReturnType<typeof createLocalFileTeachingLedgerRepository>;

export type LearningAccess = Readonly<{
  sessionModule: ReturnType<typeof createSessionModule>;
  teachingRuntime: ReturnType<typeof createInteractiveTeaching>;
  teachingContextSources: TeachingContextSources;
  getRecord: LearningRepositories['get'];
  listRecords: LearningRepositories['list'];
  listMessages: MessageLog['list'];
  getTeachingLedger: TeachingLedgerRepository['get'];
  captureTeachingProfileCheckpoint(checkpoint: TeachingCheckpointSnapshot): Promise<void>;
}>;

export type LocalLearningRuntime = Readonly<{
  routes: LearningSessionRouteOptions;
  access: LearningAccess;
  recoverTeachingSessions(): Promise<void>;
  getProjectionStatus(): 'ready' | 'degraded';
}>;

export function activeKnowledgePointRefForProgress(
  state: TeachingStateSnapshot | undefined,
  firstKnowledgePointRef: string | undefined,
): string | undefined {
  if (state?.activeKnowledgePointRef !== undefined) return state.activeKnowledgePointRef;
  const phase = state?.lessonPhase ?? 'warmup';
  return phase === 'warmup' || phase === 'knowledge_point' ? firstKnowledgePointRef : undefined;
}

export function createLocalLearningRuntime(
  input: Readonly<{
    dataRoot: DataRoot;
    unitOfWork: UnitOfWork;
    artifactStore: ReturnType<typeof createMarkdownArtifactStore>;
    instanceId: string;
    now: () => Date;
    course: LocalCourseRuntime;
    generation: LocalGenerationRuntime;
    events: LocalEventFactsRuntime;
    profile: LocalProfileRuntime;
    logProjectionEvent?: (input: StructuredLogInput) => Promise<void>;
  }>,
): LocalLearningRuntime {
  const learningRepositories = createLocalFileLearningSessionRepositories(input.dataRoot);
  const reviewRepositories = createLocalFileReviewClosureRepositories(
    input.dataRoot,
    input.unitOfWork,
  );
  const messageLog = createLocalFileMessageLog(input.dataRoot);
  const supplementaryRepository = createLocalFileSupplementarySessionRepository(input.dataRoot);
  const teachingLedgerRepository = createLocalFileTeachingLedgerRepository(input.dataRoot);
  let projectionStatus: 'ready' | 'degraded' = 'ready';
  const teachingRecoveryBySession = new Map<string, Promise<void>>();
  const generationReconciliationBySession = new Map<string, Promise<void>>();

  const sessionModule = createSessionModule({
    repositories: learningRepositories,
    messageLog,
    unitOfWork: input.unitOfWork,
    instanceId: input.instanceId,
    nextSessionId: () => `lesson_session_${randomUUID()}`,
    nextIntervalId: () => `interval_${randomUUID()}`,
    nextLeaseToken: () => `lease_${randomUUID()}`,
    now: () => new Date(),
    assertLessonWritable: input.course.access.assertLessonWritable,
    assertLessonStartable: input.course.access.assertLessonStartable,
    async recordEvents(tx, events, record) {
      const lesson = await input.course.access.getLesson(record.lessonId);
      const sessionId = record.learning.session?.id;
      const publicEvents: LearningEventEnvelope[] = [];
      const occurredAt = new Date().toISOString();
      const append = (type: LearningEventEnvelope['type'], payload: Record<string, unknown>) => {
        const eventId = `event_${randomUUID()}`;
        publicEvents.push({
          id: eventId,
          schema_version: 1,
          type,
          occurred_at: occurredAt,
          recorded_at: occurredAt,
          source: 'LearningSession',
          target_refs: {
            ...(lesson === undefined ? {} : { courseId: lesson.courseId }),
            lessonId: record.lessonId,
            ...(sessionId === undefined ? {} : { sessionId }),
          },
          payload,
          idempotency_key: eventId,
          correlation_id: eventId,
        });
      };
      for (const event of events) {
        if (event.type === 'OriginalSessionStarted') {
          append('LessonSessionStarted', { sessionId: event.sessionId });
        } else if (event.type === 'OriginalSessionPaused') {
          append('LessonSessionPaused', { sessionId });
        } else if (
          event.type === 'EvidencedLessonAbandoned' ||
          event.type === 'EvidenceFreeLessonAbandoned'
        ) {
          append('LessonAbandoned', {
            ...(sessionId === undefined ? {} : { sessionId }),
            evidenceCheckpoint: event.type === 'EvidencedLessonAbandoned',
          });
        } else if (event.type === 'AbandonedLessonRestored') {
          append('LessonRestored', { sessionId });
        } else if (event.type === 'StageReviewCommitted') {
          append('ReviewCreated', { reviewId: event.reviewId, reviewType: 'stage' });
        } else if (event.type === 'LessonCompletedPendingReview') {
          append('LessonSessionCompleted', {
            sessionId,
            reviewStatus: 'generating',
            actualSeconds: actualLearningSeconds(record.intervals),
          });
        } else if (event.type === 'FinalReviewCommitted') {
          append('ReviewFinalized', { reviewId: event.reviewId, reviewType: 'final' });
        }
      }
      await input.events.outbox.enqueue(tx, publicEvents);
    },
  });

  const teachingContextSources = createLearningTeachingContext({
    course: input.course.access,
    getLearningRecord: learningRepositories.get,
    listMessages: messageLog.list,
    artifactStore: input.artifactStore,
  });
  const teachingContextAssembler = createTeachingContextAssembler({
    sources: teachingContextSources,
  });
  const interactiveTeachingRuntime = createInteractiveTeaching({
    sessionModule,
    contextSources: teachingContextSources,
    contextAssembler: teachingContextAssembler,
    agent: createGenerationTeachingAgent({
      runtime: input.generation.runtime,
      execution: input.generation.execution,
      providerId: 'current',
    }),
    observer: createGenerationTeachingObserver({
      runtime: input.generation.runtime,
      execution: input.generation.execution,
      providerId: 'current',
      now: input.now,
    }),
    interactionSink: createLearningInteractionFactSink({
      listMessages: messageLog.list,
      outbox: input.events.outbox,
      unitOfWork: input.unitOfWork,
      now: input.now,
    }),
    reasoningBehaviorSink: input.profile.reasoningBehaviorSink,
    ledgerRepository: teachingLedgerRepository,
    unitOfWork: input.unitOfWork,
    frameLog: input.generation.frameLog,
    assistantArtifacts: {
      async save(artifactInput) {
        await input.artifactStore.saveDraft(artifactInput.artifactRef, artifactInput.markdown);
      },
    },
    nextAssistantMessageId: () => `message_${randomUUID()}`,
    nextCheckpointId: () => `teaching_checkpoint_${randomUUID()}`,
    nextTransactionId: () => `tx_teaching_${randomUUID()}`,
    now: input.now,
    resolveSession,
  });
  const supplementarySessions = createSupplementarySessionModule({
    repository: supplementaryRepository,
    messageLog,
    unitOfWork: input.unitOfWork,
    async getCompletedLesson(lessonId) {
      const learning = await learningRepositories.get(lessonId);
      if (learning?.learning.progress !== 'completed' || learning.finalReview === undefined) {
        return undefined;
      }
      const finalReview = await input.artifactStore.read(learning.finalReview.artifactRef);
      if (finalReview === undefined || finalReview.content.trim() === '') return undefined;
      const lesson = await input.course.access.getLesson(lessonId);
      if (lesson === undefined) return undefined;
      return { courseId: lesson.courseId, finalReview: learning.finalReview };
    },
    nextSessionId: () => `supplementary_${randomUUID()}`,
    now: () => new Date(),
  });
  const supplementaryLearning = createSupplementaryLearning({
    sessions: supplementarySessions,
    runtime: input.generation.runtime,
    execution: input.generation.execution,
    artifacts: input.artifactStore,
    async loadFinalReviewMarkdown(lessonId) {
      const learning = await learningRepositories.get(lessonId);
      const artifactRef = learning?.finalReview?.artifactRef;
      if (artifactRef === undefined) return undefined;
      return (await input.artifactStore.read(artifactRef))?.content;
    },
    nextMessageId: () => `message_${randomUUID()}`,
    now: input.now,
    providerId: 'current',
  });

  async function captureTeachingProfileCheckpoint(
    checkpoint: TeachingCheckpointSnapshot,
  ): Promise<void> {
    const selectedMessageIds = new Set(checkpoint.sourceMessageIds);
    const messages = (await messageLog.list(checkpoint.sessionId))
      .filter((message) => selectedMessageIds.has(message.id))
      .slice(-64);
    const sourceGroupId = `lesson:${checkpoint.lessonId}:session:${checkpoint.sessionId}`;
    const sources = (
      await Promise.all(
        messages.map(async (message) => {
          const excerpt =
            (await input.artifactStore.read(message.contentArtifactRef))?.content ??
            (await input.artifactStore.readDraft(message.contentArtifactRef));
          if (excerpt === undefined || excerpt.trim() === '') return undefined;
          return {
            sourceRef: `message:${message.id}`,
            sourceGroupId,
            sourceType: 'lesson' as const,
            role: message.role,
            excerpt,
            observedAt: message.createdAt,
          };
        }),
      )
    ).filter((source) => source !== undefined);
    if (sources.length === 0) return;
    const lesson = await input.course.access.getLesson(checkpoint.lessonId);
    const course =
      lesson === undefined ? undefined : await input.course.access.getCourse(lesson.courseId);
    void input.profile.checkpointSink.capture({
      checkpointId: `profile:${checkpoint.checkpointId}:teaching`,
      checkpointKind: 'teaching_session_closed',
      sourceType: 'lesson',
      sourceGroupId,
      dependentSourceGroupIds: [],
      ...(course === undefined ? {} : { courseContext: course.title }),
      ...(lesson === undefined ? {} : { lessonContext: `${lesson.title}｜${lesson.objective}` }),
      completeness: checkpoint.observationCompleteness === 'complete' ? 'complete' : 'partial',
      sources,
    });
  }

  async function resolveSession(sessionId: string) {
    const found = await learningRepositories.getBySessionId(sessionId);
    if (found === undefined) {
      throw Object.assign(new Error('not found'), { code: 'resource_not_found' });
    }
    const lesson = await input.course.access.getLesson(found.lessonId);
    if (lesson === undefined) {
      throw Object.assign(new Error('not found'), { code: 'resource_not_found' });
    }
    return {
      lessonId: found.lessonId,
      sessionId,
      courseId: lesson.courseId,
      lessonDefinitionId: lesson.id,
      outlineVersionId: lesson.outlineVersionId,
      ...(found.writeLease?.pageInstanceId === undefined
        ? {}
        : { pageInstanceId: found.writeLease.pageInstanceId }),
    };
  }

  const routes: LearningSessionRouteOptions = {
    module: sessionModule,
    teaching: interactiveTeachingRuntime.module,
    resolveSession,
    async reconcileSession(reference, correlationId) {
      const existing = generationReconciliationBySession.get(reference.sessionId);
      if (existing !== undefined) return existing;
      const timestamp = input.now().toISOString();
      const commandId = `reconcile_generation_${reference.sessionId}_${randomUUID()}`;
      const reconciliation = interactiveTeachingRuntime
        .reconcileGeneration({
          courseId: reference.courseId,
          lessonId: reference.lessonId,
          sessionId: reference.sessionId,
          context: {
            commandId,
            correlationId,
            idempotencyKey: commandId,
            actor: 'local-user',
            requestedAt: timestamp,
            receivedAt: timestamp,
            pageInstanceId:
              reference.pageInstanceId ?? `generation-reconciliation:${reference.sessionId}`,
          },
        })
        .finally(() => {
          generationReconciliationBySession.delete(reference.sessionId);
        });
      generationReconciliationBySession.set(reference.sessionId, reconciliation);
      return reconciliation;
    },
    async getTeachingProgress(sessionId) {
      const reference = await resolveSession(sessionId);
      const facts = await teachingContextSources.getCourseAndLesson({
        courseId: reference.courseId,
        lessonId: reference.lessonId,
      });
      const weightMetadata = await input.course.access.getTeachingWeightMetadata(
        facts.course.outlineVersionId,
      );
      let state: TeachingStateSnapshot | undefined;
      try {
        state = await interactiveTeachingRuntime.module.getTeachingState(sessionId);
      } catch (error) {
        if (!(error instanceof Error) || error.message !== 'teaching_state_not_found') throw error;
      }
      const stateByRef = new Map(state?.knowledgePoints.map((point) => [point.ref, point]));
      const activeKnowledgePointRef = activeKnowledgePointRefForProgress(
        state,
        facts.lesson.coreKnowledgePoints[0]?.ref,
      );
      return {
        ledgerVersion: state?.ledgerVersion ?? 0,
        observationStatus: state?.observationStatus ?? 'current',
        teachingWeightStatus: teachingWeightStatus(weightMetadata),
        lessonPhase: state?.lessonPhase ?? 'warmup',
        ...(activeKnowledgePointRef === undefined ? {} : { activeKnowledgePointRef }),
        comprehensiveCheck:
          state?.comprehensiveCheck === 'passed' || state?.comprehensiveCheck === 'completed'
            ? ('completed' as const)
            : state?.comprehensiveCheck === 'checking' || state?.comprehensiveCheck === 'learning'
              ? ('learning' as const)
              : (state?.comprehensiveCheck ?? ('pending' as const)),
        closureInquiry: state?.closureInquiry ?? 'pending',
        summaryStatus: state?.summaryStatus ?? 'pending',
        ...(state?.turnHandoff === undefined ? {} : { turnHandoff: state.turnHandoff }),
        knowledgePoints: facts.lesson.coreKnowledgePoints.map((knowledgePoint) => {
          const point = stateByRef.get(knowledgePoint.ref);
          return {
            ref: knowledgePoint.ref,
            title: knowledgePoint.text,
            progress:
              point?.progress === 'passed' || point?.progress === 'completed'
                ? ('completed' as const)
                : point?.progress === 'teaching' ||
                    point?.progress === 'checking' ||
                    point?.progress === 'learning'
                  ? ('learning' as const)
                  : (point?.progress ?? ('pending' as const)),
            interactionStatus:
              point?.interactionStatus ??
              (point?.progress === 'skipped' ? ('skipped' as const) : ('pending' as const)),
            delivery: point?.delivery ?? ('not_addressed' as const),
            verification: point?.verification ?? ('not_observed' as const),
            unresolvedQuestionCount: point?.unresolvedEntryRefs.length ?? 0,
            emphasis: emphasisFor({
              fixedImportance: knowledgePoint.fixedImportance ?? 'normal',
              adaptiveDifficulty: point?.adaptiveDifficulty ?? 'normal',
              depthPreference: point?.depthPreference ?? 'default',
            }),
          };
        }),
      };
    },
    async saveUserMessage(messageId, markdown) {
      await input.artifactStore.saveDraft(messageId, markdown);
      return messageId;
    },
    async loadArtifactMarkdown(artifactRef) {
      return (
        (await input.artifactStore.read(artifactRef))?.content ??
        (await input.artifactStore.readDraft(artifactRef))
      );
    },
    listSessionMessages: (sessionId) => messageLog.list(sessionId),
    async getLessonEntryState(lessonId) {
      await input.course.access.assertLessonWritable(lessonId);
      const record = await learningRepositories.get(lessonId);
      if (record === undefined) {
        return { lessonId, progress: 'not_started', resourceVersion: 0 };
      }
      const stageReview = await reviewRepositories.stageReviews.get(reviewIdForLesson(lessonId));
      const stageReviewId = record.learning.session?.stageReviewId ?? stageReview?.reviewId;
      const stageReviewMarkdown =
        stageReviewId === undefined ||
        stageReview?.status === 'generating' ||
        stageReview?.status === 'failed'
          ? undefined
          : (
              await input.artifactStore.read(
                stageReview?.artifactRef ?? `lesson_review_${stageReviewId}`,
              )
            )?.content;
      const stageReviewDocument = stageReview?.document;
      const stageReviewStatus =
        stageReviewMarkdown !== undefined
          ? ('ready' as const)
          : stageReview?.status === 'failed'
            ? ('failed' as const)
            : stageReview?.status === 'generating' || record.learning.progress === 'abandoned'
              ? ('generating' as const)
              : undefined;
      return {
        lessonId,
        progress: record.learning.progress,
        ...(record.learning.session?.id === undefined
          ? {}
          : { sessionId: record.learning.session.id }),
        ...(stageReviewMarkdown === undefined ? {} : { stageReviewMarkdown }),
        ...(stageReviewDocument === undefined ? {} : { stageReviewDocument }),
        ...(stageReviewStatus === undefined ? {} : { stageReviewStatus }),
        resourceVersion: record.resourceVersion,
      };
    },
    async getLessonRecord(lessonId) {
      const record = await learningRepositories.get(lessonId);
      const sessionId = record?.learning.session?.id;
      if (
        record === undefined ||
        sessionId === undefined ||
        record.learning.progress === 'not_started'
      ) {
        throw Object.assign(new Error('not found'), { code: 'resource_not_found' });
      }
      const stageReview = await reviewRepositories.stageReviews.get(reviewIdForLesson(lessonId));
      let finalClosure: LessonClosureRecord | undefined;
      if (record.learning.progress === 'completed') {
        finalClosure = await reviewRepositories.lessonClosures.findLatest(lessonId, sessionId);
      }
      const [lesson, messages] = await Promise.all([
        input.course.access.getLesson(lessonId),
        messageLog.list(sessionId),
      ]);
      if (lesson === undefined) {
        throw Object.assign(new Error('not found'), { code: 'resource_not_found' });
      }
      const course = await input.course.access.getCourse(lesson.courseId);
      if (course === undefined) {
        throw Object.assign(new Error('not found'), { code: 'resource_not_found' });
      }
      const originalMessages = collapseRetryDuplicateUserMessages(
        await Promise.all(
          messages.map(async (message) => {
            const markdown =
              (await input.artifactStore.read(message.contentArtifactRef))?.content ??
              (await input.artifactStore.readDraft(message.contentArtifactRef));
            return { id: message.id, role: message.role, markdown: markdown ?? '' };
          }),
        ),
      );
      const supplementary = [];
      for await (const session of supplementarySessions.listByLesson(lessonId)) {
        const loggedMessages = await supplementarySessions.listMessages(session.id);
        const loggedById = new Map(loggedMessages.map((message) => [message.id, message]));
        const projectedMessages = session.messageIds.map(
          (messageId) =>
            loggedById.get(messageId) ?? {
              id: messageId,
              role: 'user' as const,
              contentArtifactRef: messageId,
            },
        );
        const sessionMessages = await Promise.all(
          projectedMessages.map(async (message) => {
            const markdown =
              (await input.artifactStore.read(message.contentArtifactRef))?.content ??
              (await input.artifactStore.readDraft(message.contentArtifactRef));
            return { id: message.id, role: message.role, markdown: markdown ?? '' };
          }),
        );
        supplementary.push({
          sessionId: session.id,
          label: session.title ?? `补充学习 ${supplementary.length + 1}`,
          resourceVersion: session.resourceVersion,
          createdAt: session.createdAt,
          status: session.status,
          messages: sessionMessages,
        });
      }
      const reviewKind =
        record.learning.progress === 'completed' ? ('final' as const) : ('stage' as const);
      const reviewArtifactRef =
        reviewKind === 'final' ? record.finalReview?.artifactRef : stageReview?.artifactRef;
      const finalReviewMarkdown =
        reviewArtifactRef === undefined
          ? undefined
          : (await input.artifactStore.read(reviewArtifactRef))?.content;
      const reviewDocument =
        reviewKind === 'final' ? record.finalReview?.document : stageReview?.document;
      const endedAt =
        record.finalReview?.committedAt ??
        finalClosure?.updatedAt ??
        stageReview?.updatedAt ??
        [...record.intervals].reverse().find((interval) => interval.endedAt !== undefined)
          ?.endedAt ??
        record.intervals.at(-1)?.startedAt ??
        input.now().toISOString();
      const reviewStatus =
        finalReviewMarkdown !== undefined
          ? ('ready' as const)
          : reviewKind === 'final'
            ? finalClosure?.state === 'generating-failed' ||
              finalClosure?.state === 'completed' ||
              finalClosure === undefined
              ? ('failed' as const)
              : ('generating' as const)
            : stageReview?.status === 'failed'
              ? ('failed' as const)
              : ('generating' as const);
      const reviewErrorCode =
        reviewStatus !== 'failed'
          ? undefined
          : reviewKind === 'final'
            ? (finalClosure?.errorCode ??
              (finalClosure?.state === 'completed'
                ? 'final_review_artifact_missing'
                : 'final_review_transaction_missing'))
            : (stageReview?.errorCode ?? 'stage_review_generation_failed');
      const reviewRetry =
        reviewKind === 'final' && finalClosure?.state === 'generating-failed'
          ? {
              transactionId: finalClosure.transactionId,
              resourceVersion: finalClosure.resourceVersion,
            }
          : undefined;
      return {
        lessonId,
        courseId: lesson.courseId,
        title: lesson.title,
        courseTitle: course.title,
        completedAt: endedAt,
        actualSeconds: actualLearningSeconds(record.intervals),
        progress: record.learning.progress,
        reviewKind,
        reviewStatus,
        ...(reviewErrorCode === undefined ? {} : { reviewErrorCode }),
        ...(reviewRetry === undefined ? {} : { reviewRetry }),
        original: { sessionId, label: '原始学习', messages: originalMessages },
        supplementary,
        ...(finalReviewMarkdown === undefined ? {} : { finalReviewMarkdown }),
        ...(reviewDocument === undefined ? {} : { reviewDocument }),
      };
    },
    nextCommandId: () => `command_${randomUUID()}`,
    nextCorrelationId: () => `correlation_${randomUUID()}`,
    nextMessageId: () => `message_${randomUUID()}`,
    now: () => new Date(),
    supplementary: {
      start: supplementaryLearning.start,
      view: supplementaryLearning.view,
      send: supplementaryLearning.send,
      revise: supplementaryLearning.revise,
      retry: supplementaryLearning.retry,
      rename: supplementaryLearning.rename,
      stop: supplementaryLearning.stop,
      archive: supplementaryLearning.archive,
    },
  };

  return {
    routes,
    access: {
      sessionModule,
      teachingRuntime: interactiveTeachingRuntime,
      teachingContextSources,
      getRecord: (lessonId) => learningRepositories.get(lessonId),
      listRecords: () => learningRepositories.list(),
      listMessages: (sessionId) => messageLog.list(sessionId),
      getTeachingLedger: (sessionId) => teachingLedgerRepository.get(sessionId),
      captureTeachingProfileCheckpoint,
    },
    async recoverTeachingSessions() {
      for await (const record of learningRepositories.list()) {
        if (!isTeachingSessionRecoveryEligible(record.learning)) continue;
        const sessionId = record.learning.session?.id;
        if (sessionId === undefined) continue;
        if (teachingRecoveryBySession.has(sessionId)) continue;
        const lesson = await input.course.access.getLesson(record.lessonId);
        if (lesson === undefined) continue;
        const timestamp = input.now().toISOString();
        const recovery = interactiveTeachingRuntime
          .recoverSession({
            courseId: lesson.courseId,
            lessonId: lesson.id,
            sessionId,
            context: {
              commandId: `recover_teaching_${sessionId}`,
              correlationId: `recover_teaching_${sessionId}`,
              idempotencyKey: `recover_teaching_${sessionId}`,
              actor: 'local-user',
              requestedAt: timestamp,
              receivedAt: timestamp,
              ...(record.writeLease?.pageInstanceId === undefined
                ? {}
                : { pageInstanceId: record.writeLease.pageInstanceId }),
            },
          })
          .catch(async (error: unknown) => {
            projectionStatus = 'degraded';
            await input
              .logProjectionEvent?.({
                level: 'error',
                component: 'TeachingSessionRecovery',
                correlationId: `recover_teaching_${sessionId}`,
                eventCode: 'teaching_session_recovery_failed',
                fields: { lessonId: record.lessonId, sessionId, error },
              })
              .catch(() => undefined);
          })
          .finally(() => {
            teachingRecoveryBySession.delete(sessionId);
          });
        teachingRecoveryBySession.set(sessionId, recovery);
      }
    },
    getProjectionStatus: () => projectionStatus,
  };
}
