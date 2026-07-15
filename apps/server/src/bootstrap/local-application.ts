import { createHash, randomUUID } from 'node:crypto';

import {
  EVENT_TYPES,
  type LearningEventEnvelope,
  type ProfileEvidenceCheckpointKind,
  type TeachingCheckpointSnapshot,
  type TeachingStateSnapshot,
} from '@learning-more/contracts';

import { createCandidateGenerationCoordinator } from '../modules/course-authoring/implementation/candidate-generation-coordinator.js';
import { createGenerationCandidateAlignmentPlanner } from '../modules/course-authoring/implementation/generation-candidate-alignment-planner.js';
import { createGenerationAuthoringAgent } from '../modules/course-authoring/implementation/generation-authoring-agent.js';
import { createCourseAuthoringFacade } from '../modules/course-authoring/implementation/course-authoring-facade.js';
import { createCourseArchiveDeletion } from '../modules/course-authoring/implementation/course-archive-deletion.js';
import { createCourseAuthoringModule } from '../modules/course-authoring/implementation/course-authoring-module.js';
import type { LessonDefinition } from '../modules/course-authoring/model/lesson-definition.js';
import { ingestSelectedMaterial } from '../modules/course-authoring/implementation/material-ingestion.js';
import { closeCourse as closeCourseAggregate } from '../modules/course-authoring/implementation/close-course.js';
import { createGenerationFrameLog } from '../modules/generation-runtime/implementation/frame-log.js';
import { createGenerationExecution } from '../modules/generation-runtime/implementation/generation-execution.js';
import { createGenerationRuntime } from '../modules/generation-runtime/implementation/generation-runtime.js';
import { createGenerationReasoningBehaviorAnalyzer } from '../modules/global-user-profile/implementation/generation-reasoning-behavior-analyzer.js';
import { createReasoningBehaviorModule } from '../modules/global-user-profile/implementation/reasoning-behavior-module.js';
import type { ReasoningBehaviorAnalysisRecord } from '../modules/global-user-profile/ports/reasoning-behavior-repository.js';
import { createTeachingContextAssembler } from '../modules/interactive-teaching/implementation/context-assembler.js';
import { createGenerationTeachingAgent } from '../modules/interactive-teaching/implementation/generation-teaching-agent.js';
import { createGenerationTeachingObserver } from '../modules/interactive-teaching/implementation/generation-teaching-observer.js';
import { createInteractiveTeaching } from '../modules/interactive-teaching/implementation/interactive-teaching.js';
import { teachingPlayIntent } from '../modules/interactive-teaching/implementation/teaching-play-intent.js';
import { createGenerationNextLessonRecommender } from '../modules/next-lesson/implementation/generation-next-lesson-recommender.js';
import { resolveNextLessonRecommendation } from '../modules/next-lesson/implementation/recommendation-policy.js';
import type { TeachingContextSources } from '../modules/interactive-teaching/ports/teaching-context-sources.js';
import { createLocalFileMessageLog } from '../modules/learning-session/implementation/message-log.js';
import type { LearningSessionRecord } from '../persistence/learning-session-repositories.js';
import { createSessionModule } from '../modules/learning-session/implementation/session-module.js';
import { actualLearningSeconds } from '../modules/learning-session/implementation/time-intervals.js';
import { createSupplementarySessionModule } from '../modules/learning-session/implementation/supplementary-session-module.js';
import { abandonLesson } from '../modules/learning-session/implementation/abandon-lesson.js';
import { createFactProjector } from '../modules/learning-facts/implementation/fact-projector.js';
import type { LearningFact } from '../modules/learning-facts/interface.js';
import { createCalendarProjection } from '../modules/learning-facts/implementation/projections/calendar.js';
import { createCourseSummaryProjection } from '../modules/learning-facts/implementation/projections/course-summary.js';
import { createHistoryProjection } from '../modules/learning-facts/implementation/projections/history.js';
import { createStatisticsProjection } from '../modules/learning-facts/implementation/projections/statistics.js';
import { createWeeklyProjection } from '../modules/learning-facts/implementation/projections/weekly.js';
import { createWeeklyReportScheduler } from '../modules/learning-facts/implementation/weekly-report-scheduler.js';
import { createWeeklyReportService } from '../modules/learning-facts/implementation/weekly-report-service.js';
import { createProfileEvidencePipeline } from '../modules/profile-evidence/implementation/pipeline.js';
import { queryGlobalLearningProfile } from '../modules/profile-evidence/implementation/profile-query.js';
import { createReasoningEvidenceProjector } from '../modules/profile-evidence/implementation/reasoning-evidence-projector.js';
import { createAiProfileEvidenceExtractor } from '../modules/profile-evidence/implementation/ai-profile-evidence-extractor.js';
import { createProfileEvidenceAggregator } from '../modules/profile-evidence/implementation/profile-evidence-aggregator.js';
import { packPortraitEvidence } from '../modules/learning-portrait/implementation/evidence-packer.js';
import { createPortraitModule } from '../modules/learning-portrait/implementation/portrait-module.js';
import { createPlanFlowService } from '../modules/planning/implementation/plan-flow-service.js';
import { createPlanningModule } from '../modules/planning/implementation/planning-module.js';
import { createCourseReviewWorkflow } from '../modules/review-closure/implementation/course-review.js';
import { createLessonClosureWorkflow } from '../modules/review-closure/implementation/lesson-closure.js';
import { createGenerationReviewWriter } from '../modules/review-closure/implementation/generation-review-writer.js';
import {
  createStageReviewWorkflow,
  reviewIdForLesson,
} from '../modules/review-closure/implementation/stage-review.js';
import { createLocalFileCourseAuthoringRepositories } from '../persistence/course-authoring-repositories.js';
import { createLocalFileCourseCreationRepositories } from '../persistence/course-creation-repositories.js';
import {
  createLocalFileCourseArchiveStore,
  createLocalFileOutlineSessionDraftStore,
  readPortraitRefreshState,
  stagePortraitRefreshState,
} from '../persistence/course-archive-store.js';
import { DataRoot } from '../persistence/data-root.js';
import { createEventDispatcher } from '../persistence/event-dispatcher.js';
import { createEventLog } from '../persistence/event-log.js';
import { createLocalFileRepositories } from '../persistence/local-file-repositories.js';
import { createLocalFileLearningSessionRepositories } from '../persistence/learning-session-repositories.js';
import { createLocalFileFactRepository } from '../persistence/learning-facts-repositories.js';
import { createMarkdownArtifactStore } from '../persistence/markdown-artifact-store.js';
import { createOutbox } from '../persistence/outbox.js';
import { RepositoryVersionConflictError } from '../persistence/repository-errors.js';
import { createStorePaths, initializeStoreLayout } from '../persistence/paths.js';
import {
  createLocalFilePlanFlowRepository,
  createLocalFileScheduleRepository,
} from '../persistence/planning-repositories.js';
import { recoverTransactions } from '../persistence/recover-transactions.js';
import { createLocalFileReviewClosureRepositories } from '../persistence/review-closure-repositories.js';
import { createLocalFileSupplementarySessionRepository } from '../persistence/supplementary-session-repository.js';
import { createLocalFileTeachingLedgerRepository } from '../persistence/teaching-ledger-repositories.js';
import { createLocalFileReasoningBehaviorRepository } from '../persistence/reasoning-behavior-repositories.js';
import { createUnitOfWork } from '../persistence/unit-of-work.js';
import { createLocalFileWeeklyReportRepository } from '../persistence/weekly-report-repositories.js';
import { createLocalFileEvidenceRepositories } from '../persistence/profile-evidence-repositories.js';
import { latestLearningActivityAt } from './home-dashboard.js';
import { createLocalFilePortraitRepository } from '../persistence/portrait-repositories.js';
import type { ServerDependencies } from './app.js';
import { createMemorySecretStore } from '../runtime/memory-secret-store.js';
import {
  createMemoryProviderConfigRepository,
  createProviderConfigService,
} from '../runtime/provider-config-service.js';
import type { LocalApplication, LocalApplicationOptions } from './local-application/contracts.js';
import { createLocalMockProvider } from './local-application/mock-provider-script.js';

function parseStructuredJson(markdown: string): unknown {
  const trimmed = markdown.trim();
  const fenced = /^```(?:json)?\s*\r?\n([\s\S]*?)\r?\n```$/u.exec(trimmed);
  return JSON.parse((fenced?.[1] ?? trimmed).trim()) as unknown;
}

export async function createLocalApplication(
  options: LocalApplicationOptions,
): Promise<LocalApplication> {
  const dataRoot = DataRoot.create(options.dataRoot);
  await initializeStoreLayout(createStorePaths(dataRoot));
  await recoverTransactions(dataRoot);
  const unitOfWork = createUnitOfWork({ dataRoot });
  const runtimeNow = options.now ?? (() => new Date());
  const runtimeInstanceId = options.runtimeIdentity?.instanceId ?? `instance_${randomUUID()}`;
  const authoringRepositories = createLocalFileCourseAuthoringRepositories(dataRoot);
  const courseRepositories = createLocalFileCourseCreationRepositories(dataRoot);
  async function assertCourseWritable(courseId: string): Promise<void> {
    if ((await courseRepositories.courses.get(courseId)) === undefined) {
      throw Object.assign(new Error('resource_not_found'), { code: 'resource_not_found' });
    }
  }
  async function assertLessonWritable(lessonId: string): Promise<void> {
    const lesson = await courseRepositories.lessons.get(lessonId);
    if (lesson === undefined) {
      throw Object.assign(new Error('resource_not_found'), { code: 'resource_not_found' });
    }
    await assertCourseWritable(lesson.courseId);
  }
  const localRepositories = createLocalFileRepositories(dataRoot);
  const frameLog = createGenerationFrameLog(dataRoot);
  const provider = createLocalMockProvider({
    mockFailOnce: options.mockFailOnce === true,
  });
  const providers = options.providers ?? [provider, ...(options.additionalProviders ?? [])];
  const generationRuntime = createGenerationRuntime({
    repository: localRepositories.generationTasks,
    unitOfWork,
    providers,
    ...(options.initialProviderId === undefined
      ? {}
      : { initialProviderId: options.initialProviderId }),
    ...(options.defaultFallbackProviderIds === undefined
      ? {}
      : { defaultFallbackProviderIds: options.defaultFallbackProviderIds }),
    ...(options.defaultMaxAttempts === undefined
      ? {}
      : { defaultMaxAttempts: options.defaultMaxAttempts }),
    nextId: () => `task_${randomUUID()}`,
    now: runtimeNow,
  });
  const generationExecution = createGenerationExecution({
    runtime: generationRuntime,
    frameLog,
  });
  const nextLessonRecommender = createGenerationNextLessonRecommender({
    execution: generationExecution,
    providerId: 'current',
  });
  const providerConfigService = createProviderConfigService({
    runtime: generationRuntime,
    secrets: options.secretStore ?? createMemorySecretStore(runtimeNow),
    repository: options.providerConfigRepository ?? createMemoryProviderConfigRepository(),
    now: runtimeNow,
  });
  let runtimeProviderStatus: 'ready' | 'degraded' = 'ready';
  let teachingProjectionStatus: 'ready' | 'degraded' = 'ready';
  const savedProviderConfiguration = await providerConfigService.getConfiguration();
  if (savedProviderConfiguration !== undefined) {
    try {
      await providerConfigService.switchProvider({
        providerId: savedProviderConfiguration.providerId,
        publicConfig: savedProviderConfiguration.publicConfig,
        secretHandles: savedProviderConfiguration.secretHandles,
      });
    } catch {
      runtimeProviderStatus = 'degraded';
    }
  }
  const artifactStore = createMarkdownArtifactStore(dataRoot, unitOfWork);
  const authoringModule = createCourseAuthoringModule({
    repositories: authoringRepositories,
    unitOfWork,
    generationRuntime,
    providerId: 'current',
    draftStore: artifactStore,
  });
  const candidateGeneration = createCandidateGenerationCoordinator({
    module: authoringModule,
    repositories: authoringRepositories,
    runtime: generationRuntime,
    execution: generationExecution,
    frameLog,
    nextCandidateId: () => `candidate_${randomUUID()}`,
  });
  const eventLog = createEventLog(dataRoot);
  const eventDispatcher = createEventDispatcher();
  const factRepository = createLocalFileFactRepository(dataRoot);
  const evidenceRepositories = createLocalFileEvidenceRepositories(dataRoot);
  const profileEvidenceExtractor = createAiProfileEvidenceExtractor({
    runtime: generationRuntime,
    execution: generationExecution,
    providerId: 'current',
    analyzerVersion: 'profile-evidence-analyzer@1',
    extractorVersion: 'profile-evidence@1',
    now: runtimeNow,
  });
  const profileEvidenceAggregator = createProfileEvidenceAggregator({
    repositories: evidenceRepositories,
    unitOfWork,
    now: runtimeNow,
    nextTransactionId: () => `tx_profile_evidence_${randomUUID()}`,
  });
  let profileEvidenceBarrier: Promise<void> = Promise.resolve();
  let lastProfileEvidenceError: string | undefined;
  function enqueueProfileEvidenceCheckpoint(input: unknown): void {
    const queued = profileEvidenceBarrier.then(async () => {
      if (typeof input !== 'object' || input === null || Array.isArray(input)) {
        throw new Error('profile_checkpoint_invalid');
      }
      const existingCandidates = [];
      for await (const candidate of evidenceRepositories.evidence.list()) {
        if (candidate.status !== 'active' || candidate.governance === undefined) continue;
        existingCandidates.push({
          evidenceId: candidate.evidenceId,
          semanticKey: candidate.governance.semanticKey,
          claimDimension: candidate.claimDimension,
          summary: candidate.summary,
          sourceGroupId: candidate.sourceGroupId,
        });
      }
      const extracted = await profileEvidenceExtractor.extract({
        ...(input as Record<string, unknown>),
        existingCandidates,
      });
      await profileEvidenceAggregator.ingest(extracted);
      if (
        extracted.checkpoint.checkpointKind === 'authoring_candidate_confirmed' &&
        extracted.checkpoint.courseId !== undefined &&
        extracted.checkpoint.courseMode !== undefined
      ) {
        await reasoningBehaviorModule.captureFromConfirmedAuthoring({
          courseId: extracted.checkpoint.courseId,
          courseMode: extracted.checkpoint.courseMode,
          checkpointId: extracted.checkpoint.checkpointId,
          sourceGroupId: extracted.checkpoint.sourceGroupId,
          sourceSnapshotHash: extracted.sourceSnapshotHash,
          extractedAt: extracted.extractedAt,
          sources: extracted.checkpoint.sources.map((source) => ({
            sourceRef: source.sourceRef,
            role: source.role === 'user' ? 'user' : 'assistant',
            observedAt: source.observedAt,
          })),
          candidates: extracted.candidates,
        });
      }
      lastProfileEvidenceError = undefined;
    });
    profileEvidenceBarrier = queued.catch((error: unknown) => {
      lastProfileEvidenceError =
        error instanceof Error ? error.message : 'profile_evidence_extraction_failed';
    });
  }
  const portraitRepository = createLocalFilePortraitRepository(dataRoot);
  const factProjector = createFactProjector({ repository: factRepository, unitOfWork });
  for (const eventType of EVENT_TYPES) {
    eventDispatcher.register(eventType, async (event) => {
      await factProjector.project(event);
    });
  }
  for (const event of await eventLog.readAll()) await factProjector.project(event);
  const outbox = createOutbox({
    dataRoot,
    unitOfWork,
    eventLog,
    dispatcher: eventDispatcher,
  });
  let outboxBarrier: Promise<void> = Promise.resolve();
  async function dispatchOutbox(): Promise<void> {
    const dispatch = outboxBarrier.then(async () => {
      await outbox.dispatchPending(10_000);
    });
    outboxBarrier = dispatch.catch(() => undefined);
    await dispatch;
  }
  await dispatchOutbox();
  const nextId = (kind: 'session' | 'course' | 'event' | 'outline' | 'adjustment' | 'message') =>
    `${kind}_${randomUUID()}`;
  const courseArchiveDeletion = createCourseArchiveDeletion({
    store: createLocalFileCourseArchiveStore(dataRoot),
    unitOfWork,
    outbox,
    async requestPortraitRefresh({ courseId, idempotencyKey }) {
      try {
        await requestPortraitRefresh({ idempotencyKey, tokenBudget: 8_000 });
        await unitOfWork.execute(
          { transactionId: `tx_portrait_refresh_state_${randomUUID()}` },
          (tx) => stagePortraitRefreshState(tx, undefined),
        );
      } catch (error) {
        await unitOfWork.execute(
          { transactionId: `tx_portrait_refresh_state_${randomUUID()}` },
          (tx) =>
            stagePortraitRefreshState(tx, {
              schemaVersion: 1,
              state: 'failed',
              reason: 'course_deleted',
              courseId,
              updatedAt: runtimeNow().toISOString(),
              errorCode: 'portrait_refresh_failed',
            }),
        );
        throw error;
      }
    },
    nextEventId: () => `event_${randomUUID()}`,
    now: runtimeNow,
  });
  const courseAuthoring = createCourseAuthoringFacade({
    authoring: authoringRepositories,
    courses: courseRepositories,
    unitOfWork,
    candidateGeneration,
    authoringAgent: createGenerationAuthoringAgent({
      execution: generationExecution,
      providerId: 'current',
    }),
    candidateAlignmentPlanner: createGenerationCandidateAlignmentPlanner({
      execution: generationExecution,
      providerId: 'current',
    }),
    nextLessonRecommender,
    outbox,
    profileEvidenceSink: { capture: enqueueProfileEvidenceCheckpoint },
    nextId,
    now: () => new Date(),
    courseArchiveDeletion,
    outlineSessionDraftStore: createLocalFileOutlineSessionDraftStore(dataRoot),
  });
  const learningRepositories = createLocalFileLearningSessionRepositories(dataRoot);
  async function refreshNextLessonRecommendation(
    courseId: string,
    trigger: 'lesson-completed' | 'schedule-changed' = 'lesson-completed',
    currentLessonId?: string,
  ): Promise<void> {
    const course = await courseRepositories.courses.get(courseId);
    if (course === undefined || course.status !== 'active') return;
    const lessons: LessonDefinition[] = [];
    for (const lessonId of course.lessonIds) {
      const lesson = await courseRepositories.lessons.get(lessonId);
      if (lesson !== undefined) lessons.push(lesson);
    }
    const semanticKeyById = new Map(lessons.map((lesson) => [lesson.id, lesson.semanticKey]));
    const completedSemanticKeys = [];
    const learningByLessonId = new Map<string, LearningSessionRecord | undefined>();
    for (const lesson of lessons) {
      const learning = await learningRepositories.get(lesson.id);
      learningByLessonId.set(lesson.id, learning);
      if (learning?.learning.progress === 'completed') {
        completedSemanticKeys.push(lesson.semanticKey);
      }
    }
    const scheduled = (await planning.list()).filter(
      (item) => item.courseId === courseId && item.status === 'scheduled',
    );
    const currentLearning =
      currentLessonId === undefined ? undefined : learningByLessonId.get(currentLessonId);
    const currentFinalReviewMarkdown =
      currentLearning?.finalReview?.artifactRef === undefined
        ? undefined
        : (await artifactStore.read(currentLearning.finalReview.artifactRef))?.content;
    const previous = course.nextLessonRecommendation;
    const previousSemanticKey =
      previous === undefined ? undefined : semanticKeyById.get(previous.recommendedLessonId);
    const recommendation = await resolveNextLessonRecommendation({
      recommender: nextLessonRecommender,
      now: runtimeNow,
      input: {
        courseId,
        trigger,
        candidates: lessons.map((lesson) => {
          const learning = learningByLessonId.get(lesson.id);
          const scheduledStartAt = scheduled.find((item) => item.lessonId === lesson.id)?.startAt;
          return {
            semanticKey: lesson.semanticKey,
            title: lesson.title,
            objective: lesson.objective,
            prerequisiteSemanticKeys: lesson.prerequisiteLessonIds
              .map((id) => semanticKeyById.get(id))
              .filter((value): value is string => value !== undefined),
            estimatedMinutes: lesson.estimatedMinutes,
            progress: learning?.learning.progress ?? 'not_started',
            courseStatus: course.status,
            available: course.lessonIds.includes(lesson.id),
            activeSession: learning?.learning.progress === 'in_progress',
            ...(scheduledStartAt === undefined ? {} : { scheduledStartAt }),
            evidenceRefs: [
              ...lesson.sourceRefs,
              ...(learning?.finalReview?.artifactRef === undefined
                ? []
                : [learning.finalReview.artifactRef]),
            ],
          };
        }),
        completedSemanticKeys,
        ...(currentFinalReviewMarkdown === undefined ? {} : { currentFinalReviewMarkdown }),
        ...(scheduled.length === 0
          ? {}
          : {
              planSummary: scheduled
                .map((item) => `${item.lessonId}: ${item.startAt} - ${item.endAt}`)
                .join('\n'),
            }),
        ...(previous === undefined || previousSemanticKey === undefined
          ? {}
          : {
              previousRecommendation: {
                versionId: previous.versionId,
                semanticKey: previousSemanticKey,
                rankedSemanticKeys: previous.rankedLessonIds
                  .map((id) => semanticKeyById.get(id))
                  .filter((key): key is string => key !== undefined),
                rationale: previous.rationale,
                evidenceRefs: previous.evidenceRefs,
                confidence: previous.confidence,
                expiresAt: previous.expiresAt,
                sourceSnapshotHash: previous.sourceSnapshotHash,
                status: previous.status,
                warnings: previous.warnings,
              },
            }),
      },
    });
    const selected =
      recommendation === undefined
        ? undefined
        : lessons.find((lesson) => lesson.semanticKey === recommendation.semanticKey);
    if (recommendation !== undefined && selected === undefined) {
      throw new Error('next_lesson_recommendation_invalid');
    }
    const {
      recommendedLessonId: _previousRecommendedLessonId,
      nextLessonRecommendation: _previousRecommendation,
      ...courseWithoutRecommendation
    } = course;
    void _previousRecommendedLessonId;
    void _previousRecommendation;
    await unitOfWork.execute(
      { transactionId: `tx_next_lesson_${courseId}_${course.resourceVersion}` },
      (tx) =>
        courseRepositories.courses.save(
          tx,
          {
            ...courseWithoutRecommendation,
            ...(selected === undefined ? {} : { recommendedLessonId: selected.id }),
            ...(recommendation === undefined || selected === undefined
              ? {}
              : {
                  nextLessonRecommendation: {
                    versionId: recommendation.versionId,
                    recommendedLessonId: selected.id,
                    rankedLessonIds: recommendation.rankedSemanticKeys
                      .map((key) => lessons.find((lesson) => lesson.semanticKey === key)?.id)
                      .filter((id): id is string => id !== undefined),
                    rationale: recommendation.rationale,
                    evidenceRefs: recommendation.evidenceRefs,
                    confidence: recommendation.confidence,
                    expiresAt: recommendation.expiresAt,
                    sourceSnapshotHash: recommendation.sourceSnapshotHash,
                    status: recommendation.status,
                    warnings: recommendation.warnings,
                  },
                }),
          },
          course.resourceVersion,
        ),
    );
  }
  const reviewClosureRepositories = createLocalFileReviewClosureRepositories(dataRoot);
  const messageLog = createLocalFileMessageLog(dataRoot);
  const supplementaryRepository = createLocalFileSupplementarySessionRepository(dataRoot);
  const sessionModule = createSessionModule({
    repositories: learningRepositories,
    messageLog,
    unitOfWork,
    instanceId: runtimeInstanceId,
    nextSessionId: () => `lesson_session_${randomUUID()}`,
    nextIntervalId: () => `interval_${randomUUID()}`,
    nextLeaseToken: () => `lease_${randomUUID()}`,
    now: () => new Date(),
    assertLessonWritable,
    async recordEvents(tx, events, record) {
      const lesson = await courseRepositories.lessons.get(record.lessonId);
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
        } else if (event.type === 'FinalReviewCommitted') {
          append('ReviewFinalized', { reviewId: event.reviewId, reviewType: 'final' });
          append('LessonSessionCompleted', {
            sessionId,
            reviewId: event.reviewId,
            actualSeconds: actualLearningSeconds(record.intervals),
          });
        }
      }
      await outbox.enqueue(tx, publicEvents);
    },
  });
  const teachingLedgerRepository = createLocalFileTeachingLedgerRepository(dataRoot);
  const reasoningBehaviorRepository = createLocalFileReasoningBehaviorRepository(dataRoot);
  const reasoningBehaviorModule = createReasoningBehaviorModule({
    repository: reasoningBehaviorRepository,
    unitOfWork,
    analyzer: createGenerationReasoningBehaviorAnalyzer({
      runtime: generationRuntime,
      execution: generationExecution,
      providerId: 'current',
      analyzerVersion: 'reasoning-analyzer@1',
    }),
    now: runtimeNow,
    nextTransactionId: () => `tx_reasoning_${randomUUID()}`,
  });
  const reasoningEvidenceProjector = createReasoningEvidenceProjector({
    reasoningRepository: reasoningBehaviorRepository,
    evidenceRepositories,
    unitOfWork,
    now: runtimeNow,
    nextTransactionId: () => `tx_reasoning_evidence_${randomUUID()}`,
  });
  async function latestUsableReasoningAnalysis() {
    let latest: ReasoningBehaviorAnalysisRecord | undefined;
    for await (const analysis of reasoningBehaviorRepository.listAnalyses()) {
      if (analysis.snapshot.status !== 'usable') continue;
      const filter = analysis.snapshot.filter;
      if (
        filter.windowStart !== undefined ||
        filter.windowEnd !== undefined ||
        filter.courseIds.length > 0 ||
        filter.lessonIds.length > 0 ||
        filter.courseModes.length > 0 ||
        filter.elicitations.length > 0
      ) {
        continue;
      }
      if (latest === undefined || analysis.snapshot.createdAt > latest.snapshot.createdAt) {
        latest = analysis;
      }
    }
    return latest;
  }
  async function refreshAndProjectReasoningAnalysis(
    filter?: Parameters<typeof reasoningBehaviorModule.refreshAnalysis>[0],
  ) {
    const analysis = await reasoningBehaviorModule.refreshAnalysis(filter);
    if (analysis !== undefined) await reasoningEvidenceProjector.project(analysis);
    return analysis;
  }
  async function refreshReasoningBehaviorAnalysis(): Promise<void> {
    try {
      await refreshAndProjectReasoningAnalysis();
    } catch {
      teachingProjectionStatus = 'degraded';
    }
  }
  const teachingContextSources: TeachingContextSources = {
    async getCourseAndLesson({ courseId, lessonId }) {
      const [course, lesson] = await Promise.all([
        courseRepositories.courses.get(courseId),
        courseRepositories.lessons.get(lessonId),
      ]);
      if (course === undefined || lesson === undefined || lesson.courseId !== course.id) {
        throw Object.assign(new Error('resource_not_found'), { code: 'resource_not_found' });
      }
      const lessonMap = [];
      for await (const candidate of courseRepositories.lessons.listByCourse(courseId)) {
        lessonMap.push({
          lessonId: candidate.id,
          title: candidate.title,
          objective: candidate.objective,
          relation:
            candidate.id === lessonId
              ? ('current' as const)
              : lesson.prerequisiteLessonIds.includes(candidate.id)
                ? ('prerequisite' as const)
                : ('other' as const),
        });
      }
      const playIntent = teachingPlayIntent(course.courseMode);
      return {
        course: {
          courseId: course.id,
          outlineVersionId: course.outlineVersionId,
          title: course.title,
          courseMode: course.courseMode,
          ...(playIntent === undefined ? {} : { playIntent }),
          goals: lessonMap.map((item) => item.objective),
          lessonMap,
        },
        lesson: {
          lessonId: lesson.id,
          outlineVersionId: lesson.outlineVersionId,
          title: lesson.title,
          objective: lesson.objective,
          coreKnowledgePoints: lesson.coreKnowledgePoints.map((text) => ({
            ref: `knowledge:${lesson.id}:${createHash('sha256').update(text).digest('hex').slice(0, 16)}`,
            text,
          })),
        },
      };
    },
    async listMessages(sessionId) {
      const messages = await messageLog.list(sessionId);
      return Promise.all(
        messages.map(async (message) => ({
          messageId: message.id,
          role: message.role,
          completionStatus: message.completionStatus,
          markdown:
            (await artifactStore.read(message.contentArtifactRef))?.content ??
            (await artifactStore.readDraft(message.contentArtifactRef)) ??
            '',
          sourceRef: `message:${message.id}`,
        })),
      );
    },
    async listRelevantFinalReviews(courseId, lessonId) {
      const reviews = [];
      for await (const lesson of courseRepositories.lessons.listByCourse(courseId)) {
        if (lesson.id === lessonId) continue;
        const learning = await learningRepositories.get(lesson.id);
        if (learning?.finalReview === undefined) continue;
        const markdown = (await artifactStore.read(learning.finalReview.artifactRef))?.content;
        if (markdown === undefined) continue;
        reviews.push({
          sourceRef: `review:${learning.finalReview.id}`,
          version: learning.finalReview.contentSha256,
          markdown,
          selectedBecause: '同一课程中的已完成课节，可提供相关学习证据。',
        });
      }
      return reviews;
    },
    async listRelevantMaterialExcerpts(lessonId) {
      const lesson = await courseRepositories.lessons.get(lessonId);
      if (lesson === undefined) return [];
      const excerpts = [];
      for (const sourceRef of lesson.sourceRefs) {
        const material = await authoringRepositories.materials.get(sourceRef);
        if (material === undefined) continue;
        excerpts.push({
          sourceRef,
          version: material.sha256,
          markdown: material.extractedText,
          selectedBecause: '已由当前课节的绑定版本显式引用。',
        });
      }
      return excerpts;
    },
    async getLearningStartSummary() {
      return undefined;
    },
    async getPersonalizationView({ courseId, lessonId }) {
      const reasoning = await latestUsableReasoningAnalysis();
      const createdAt = runtimeNow().toISOString();
      const counts = new Map(
        reasoning?.snapshot.dimensions.map((count) => [count.dimensionId, count]) ?? [],
      );
      const reasoningSignals = (reasoning?.dimensions ?? [])
        .filter(
          (dimension) => (counts.get(dimension.dimensionId)?.independentSourceGroupCount ?? 0) >= 2,
        )
        .slice(0, 8)
        .map((dimension) => ({
          evidenceId: dimension.dimensionId,
          summary: `当前证据窗口中出现“${dimension.label}”：${dimension.description}`,
          explicitness: 'ai_observed' as const,
          sourceRefs: dimension.derivedFromEpisodeIds.map(
            (episodeId) => `reasoning-episode:${episodeId}`,
          ),
          limitations: [
            '这是从当前证据窗口动态归纳的学习行为维度，不是永久人格、能力等级或固定思维类型。',
          ],
        }));
      const candidateSignals = [];
      let candidateProfileVersion = 0;
      for await (const candidate of evidenceRepositories.evidence.list()) {
        const governance = candidate.governance;
        if (
          candidate.status !== 'active' ||
          governance === undefined ||
          governance.safetyStatus === 'blocked' ||
          governance.confidence < 0.65 ||
          (governance.explicitness === 'ai_observed' && governance.observedCount < 2)
        ) {
          continue;
        }
        const expiry = governance.expiryPolicy;
        const expiryAt =
          expiry.kind === 'until_corrected'
            ? undefined
            : expiry.kind === 'window_bound'
              ? expiry.expiresAt
              : expiry.reviewAt;
        if (expiryAt !== undefined && Date.parse(expiryAt) <= runtimeNow().getTime()) continue;
        candidateProfileVersion = Math.max(candidateProfileVersion, candidate.resourceVersion);
        candidateSignals.push({
          evidenceId: candidate.evidenceId,
          summary: `${governance.label}：${candidate.summary}`,
          explicitness: governance.explicitness,
          sourceRefs: [...candidate.sourceRefs],
          limitations: [
            ...governance.limitations,
            '该信号是可撤回的候选证据，只用于调整当前教学表达与探查方式，不代表已确认的全局用户档案事实。',
          ],
        });
      }
      const signals = [...candidateSignals, ...reasoningSignals]
        .filter(
          (signal, index, all) =>
            all.findIndex((candidate) => candidate.evidenceId === signal.evidenceId) === index,
        )
        .slice(0, 8);
      return {
        profileVersion: Math.max(reasoning?.resourceVersion ?? 0, candidateProfileVersion),
        purpose: 'interactive_teaching',
        courseId,
        lessonId,
        signals,
        completeness: signals.length === 0 ? 'insufficient' : 'limited',
        sourceSnapshotHash: createHash('sha256')
          .update(
            JSON.stringify({
              courseId,
              lessonId,
              reasoningSource: reasoning?.snapshot.sourceSnapshotHash,
              evidenceIds: signals.map((signal) => signal.evidenceId),
            }),
          )
          .digest('hex'),
        createdAt,
      };
    },
  };
  const teachingContextAssembler = createTeachingContextAssembler({
    sources: teachingContextSources,
  });
  const interactiveTeachingRuntime = createInteractiveTeaching({
    sessionModule,
    contextSources: teachingContextSources,
    contextAssembler: teachingContextAssembler,
    agent: createGenerationTeachingAgent({
      runtime: generationRuntime,
      execution: generationExecution,
      providerId: 'current',
    }),
    observer: createGenerationTeachingObserver({
      runtime: generationRuntime,
      execution: generationExecution,
      providerId: 'current',
      now: runtimeNow,
    }),
    reasoningBehaviorSink: reasoningBehaviorModule,
    ledgerRepository: teachingLedgerRepository,
    unitOfWork,
    frameLog,
    assistantArtifacts: {
      async save(input) {
        await artifactStore.saveDraft(input.artifactRef, input.markdown);
      },
    },
    nextAssistantMessageId: () => `message_${randomUUID()}`,
    nextCheckpointId: () => `teaching_checkpoint_${randomUUID()}`,
    nextTransactionId: () => `tx_teaching_${randomUUID()}`,
    now: runtimeNow,
  });
  const supplementarySessions = createSupplementarySessionModule({
    repository: supplementaryRepository,
    unitOfWork,
    async getCompletedLesson(lessonId) {
      const learning = await learningRepositories.get(lessonId);
      if (learning?.learning.progress !== 'completed' || learning.finalReview === undefined) {
        return undefined;
      }
      const lesson = await courseRepositories.lessons.get(lessonId);
      if (lesson === undefined) return undefined;
      return { courseId: lesson.courseId, finalReview: learning.finalReview };
    },
    nextSessionId: () => `supplementary_${randomUUID()}`,
    now: () => new Date(),
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
            (await artifactStore.read(message.contentArtifactRef))?.content ??
            (await artifactStore.readDraft(message.contentArtifactRef));
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
    const lesson = await courseRepositories.lessons.get(checkpoint.lessonId);
    const course =
      lesson === undefined ? undefined : await courseRepositories.courses.get(lesson.courseId);
    enqueueProfileEvidenceCheckpoint({
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

  async function captureReviewProfileCheckpoint(input: {
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
    if (input.markdown.trim() === '') return;
    const sourceGroupId = `review:${input.sourceRef}`;
    const [course, lesson] = await Promise.all([
      courseRepositories.courses.get(input.courseId),
      input.lessonId === undefined
        ? Promise.resolve(undefined)
        : courseRepositories.lessons.get(input.lessonId),
    ]);
    const dependentSourceGroupIds: string[] = [];
    if (input.lessonId !== undefined) {
      const learning = await learningRepositories.get(input.lessonId);
      if (learning?.learning.session?.id !== undefined) {
        dependentSourceGroupIds.push(
          `lesson:${input.lessonId}:session:${learning.learning.session.id}`,
        );
      }
    } else if (course !== undefined) {
      for (const lessonId of course.lessonIds) {
        const learning = await learningRepositories.get(lessonId);
        if (learning?.finalReview !== undefined) {
          dependentSourceGroupIds.push(`review:review:${learning.finalReview.id}`);
        }
      }
    }
    enqueueProfileEvidenceCheckpoint({
      checkpointId: `profile:${input.sourceRef}:${input.checkpointKind}`,
      checkpointKind: input.checkpointKind,
      sourceType: 'review',
      sourceGroupId,
      dependentSourceGroupIds,
      ...(course === undefined ? {} : { courseContext: course.title }),
      ...(lesson === undefined ? {} : { lessonContext: `${lesson.title}｜${lesson.objective}` }),
      completeness: 'complete',
      sources: [
        {
          sourceRef: input.sourceRef,
          sourceGroupId,
          sourceType: 'review',
          role: 'review',
          excerpt: input.markdown,
          observedAt: input.observedAt,
        },
      ],
    });
  }

  async function captureSupplementaryProfileCheckpoint(
    session: NonNullable<Awaited<ReturnType<typeof supplementarySessions.get>>>,
  ): Promise<void> {
    const sourceGroupId = `supplementary:${session.id}`;
    const sources = (
      await Promise.all(
        session.messageIds.slice(-64).map(async (messageId) => {
          const excerpt =
            (await artifactStore.read(messageId))?.content ??
            (await artifactStore.readDraft(messageId));
          if (excerpt === undefined || excerpt.trim() === '') return undefined;
          return {
            sourceRef: `supplementary:${messageId}`,
            sourceGroupId,
            sourceType: 'supplementary' as const,
            role: 'user' as const,
            excerpt,
            observedAt: session.updatedAt,
          };
        }),
      )
    ).filter((source) => source !== undefined);
    if (sources.length === 0) return;
    const lesson = await courseRepositories.lessons.get(session.lessonId);
    const course = await courseRepositories.courses.get(session.courseId);
    const learning = await learningRepositories.get(session.lessonId);
    const dependentSourceGroupIds =
      learning?.learning.session?.id === undefined
        ? []
        : [`lesson:${session.lessonId}:session:${learning.learning.session.id}`];
    enqueueProfileEvidenceCheckpoint({
      checkpointId: `profile:${session.id}:closed`,
      checkpointKind: 'supplementary_session_closed',
      sourceType: 'supplementary',
      sourceGroupId,
      dependentSourceGroupIds,
      ...(course === undefined ? {} : { courseContext: course.title }),
      ...(lesson === undefined ? {} : { lessonContext: `${lesson.title}｜${lesson.objective}` }),
      completeness: 'complete',
      sources,
    });
  }
  const reviewWriter = createGenerationReviewWriter({
    runtime: generationRuntime,
    execution: generationExecution,
    providerId: 'current',
  });
  async function buildReviewEvidencePack(
    kind: 'stage' | 'final',
    sessionId: string,
    sourceSnapshotHash: string,
  ) {
    const ledger = await teachingLedgerRepository.get(sessionId);
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
    unitOfWork,
    reviewTask: {
      async submit(input) {
        return reviewWriter.submit(
          await buildReviewEvidencePack('stage', input.sessionId, input.sourceSnapshotHash),
          input.commandId,
        );
      },
    },
    providerId: 'current',
    now: () => new Date(),
    assertLessonWritable,
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
      const record = await learningRepositories.get(lessonId);
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
  const lessonClosureRepository = reviewClosureRepositories.lessonClosures;
  const lessonClosures = createLessonClosureWorkflow({
    repository: lessonClosureRepository,
    unitOfWork,
    sessionModule,
    reviewTask: {
      async submit(input) {
        return reviewWriter.submit(
          await buildReviewEvidencePack(
            'final',
            input.record.sessionId,
            input.record.messageRangeChecksum,
          ),
          input.commandId,
        );
      },
    },
    nextTransactionId: () => `closure_${randomUUID()}`,
    nextReviewId: reviewIdForLesson,
    now: () => new Date(),
    assertLessonWritable,
  });
  const courseReviews = createCourseReviewWorkflow({
    repository: reviewClosureRepositories.courseReviews,
    unitOfWork,
    reviewTask: {
      async submit(input) {
        const course = await courseRepositories.courses.get(input.courseId);
        if (course === undefined) throw new Error('course_review_course_not_found');
        const lessons = [];
        const finalReviewLessonByRef = new Map<string, string>();
        for await (const lesson of courseRepositories.lessons.listByCourse(input.courseId)) {
          lessons.push({
            lessonId: lesson.id,
            title: lesson.title,
            objective: lesson.objective,
            coreKnowledgePoints: lesson.coreKnowledgePoints,
          });
          const learning = await learningRepositories.get(lesson.id);
          if (learning?.finalReview !== undefined) {
            finalReviewLessonByRef.set(learning.finalReview.artifactRef, lesson.id);
          }
        }
        const lessonReviews = [];
        for (const sourceRef of input.inputManifest.completedFinalReviewRefs) {
          const lessonId = finalReviewLessonByRef.get(sourceRef);
          const markdown = (await artifactStore.read(sourceRef))?.content;
          if (lessonId === undefined || markdown === undefined) {
            throw new Error('course_review_evidence_pack_incomplete');
          }
          lessonReviews.push({ lessonId, kind: 'final' as const, sourceRef, markdown });
        }
        for (const reviewId of input.inputManifest.abandonedStageReviewRefs) {
          const stageReview = await reviewClosureRepositories.stageReviews.get(reviewId);
          const artifactRef = stageReview?.artifactRef;
          const markdown =
            artifactRef === undefined
              ? undefined
              : (await artifactStore.read(artifactRef))?.content;
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
              outlineVersionId: input.inputManifest.outlineVersionId,
            },
            lessons,
            lessonReviews,
            abandonedWithoutReviewLessonIds: input.inputManifest.abandonedWithoutReviewLessonIds,
            ...(playIntent === undefined ? {} : { reviewLens: playIntent }),
          },
          input.commandId,
        );
      },
    },
    outbox,
    nextEventId: () => `event_${randomUUID()}`,
    now: () => new Date(),
    assertCourseWritable,
  });
  for await (const closure of lessonClosureRepository.list()) {
    if (closure.state !== 'committing') continue;
    const learning = await learningRepositories.get(closure.lessonId);
    const pageInstanceId = learning?.writeLease?.pageInstanceId;
    if (learning === undefined || pageInstanceId === undefined) {
      throw new Error(`LESSON_CLOSURE_RECOVERY_CONTEXT_MISSING:${closure.transactionId}`);
    }
    const recoveredAt = new Date().toISOString();
    await lessonClosures.recover(closure.transactionId, closure.messageRangeChecksum, {
      commandId: `recover_${closure.transactionId}`,
      correlationId: `recover_${closure.transactionId}`,
      idempotencyKey: `recover_${closure.transactionId}`,
      actor: 'local-user',
      requestedAt: recoveredAt,
      receivedAt: recoveredAt,
      expectedVersion: learning.resourceVersion,
      pageInstanceId,
    });
  }
  const scheduleRepository = createLocalFileScheduleRepository(dataRoot);
  const planFlowRepository = createLocalFilePlanFlowRepository(dataRoot);
  const weeklyReportRepository = createLocalFileWeeklyReportRepository(dataRoot);
  async function scheduleVersion() {
    let version = 0;
    for await (const item of scheduleRepository.list()) version += item.resourceVersion;
    return version;
  }
  const planning = createPlanningModule({
    repository: scheduleRepository,
    unitOfWork,
    async getLessonProgress(lessonId) {
      const lesson = await courseRepositories.lessons.get(lessonId);
      if (
        lesson === undefined ||
        (await courseRepositories.courses.get(lesson.courseId)) === undefined
      ) {
        return undefined;
      }
      return (await learningRepositories.get(lessonId))?.learning.progress ?? 'not_started';
    },
    nextScheduleItemId: () => `schedule_${randomUUID()}`,
    now: () => new Date(),
    async recordEvent(event, tx) {
      const envelope: LearningEventEnvelope = {
        id: `event_${randomUUID()}`,
        schema_version: 1,
        type: event.type,
        occurred_at: event.occurredAt,
        recorded_at: new Date().toISOString(),
        source: 'Planning',
        target_refs: {
          scheduleItemId: event.scheduleItemId,
          courseId: event.courseId,
          lessonId: event.lessonId,
        },
        payload: { scheduleItemId: event.scheduleItemId },
        idempotency_key: `${event.type}:${event.scheduleItemId}:${event.occurredAt}`,
        correlation_id: `${event.type}:${event.scheduleItemId}`,
      };
      await outbox.enqueue(tx, [envelope]);
    },
  });
  const planFlows = createPlanFlowService({
    repository: planFlowRepository,
    scheduleRepository,
    unitOfWork,
    async assemblePreviewContext(input) {
      const courses = [];
      for (const courseId of input.courseRefs) {
        const course = await courseRepositories.courses.get(courseId);
        if (course !== undefined) {
          courses.push({
            courseId: course.id,
            title: course.title,
            lessonIds: course.lessonIds,
          });
        }
      }
      const lessons = [];
      for (const lessonId of input.lessonRefs) {
        const lesson = await courseRepositories.lessons.get(lessonId);
        if (lesson !== undefined) {
          lessons.push({
            lessonId: lesson.id,
            courseId: lesson.courseId,
            title: lesson.title,
            objective: lesson.objective,
            prerequisiteLessonIds: lesson.prerequisiteLessonIds,
            estimatedMinutes: lesson.estimatedMinutes,
            progress:
              (await learningRepositories.get(lesson.id))?.learning.progress ?? 'not_started',
          });
        }
      }
      const existingSchedule = [];
      for await (const item of scheduleRepository.list()) existingSchedule.push(item);
      const constraints = await artifactStore.read(input.constraintsArtifactRef);
      const preference = (prefix: string) =>
        input.timeWindowRefs.find((ref) => ref.startsWith(prefix))?.slice(prefix.length);
      return {
        courses,
        lessons,
        timezone: 'Asia/Shanghai',
        availability: {
          startLocalDate: preference('start:'),
          dailyTargetMinutes: Number(preference('daily:') ?? 0),
          learningDays: preference('days:')?.split(',') ?? [],
        },
        userPreferences: {
          preserveExistingDates: preference('preserve:') === 'true',
          rescheduleOverdue: preference('overdue:') === 'true',
          strategy: preference('strategy:') ?? 'balanced',
        },
        declaredTimeWindows: input.timeWindowRefs,
        constraintsMarkdown: constraints?.content,
        existingSchedule,
        fixedCommitments: existingSchedule.filter((item) => item.locked === true),
      };
    },
    getScheduleVersion: scheduleVersion,
    lessonIsPlannable: async (lessonId) => {
      if ((await courseRepositories.lessons.get(lessonId)) === undefined) return false;
      const progress = (await learningRepositories.get(lessonId))?.learning.progress;
      return progress !== 'completed' && progress !== 'abandoned';
    },
    getLessonPrerequisiteIds: async (lessonId) =>
      (await courseRepositories.lessons.get(lessonId))?.prerequisiteLessonIds ?? [],
    nextPlanFlowId: () => `plan_flow_${randomUUID()}`,
    nextScheduleItemId: () => `schedule_${randomUUID()}`,
    now: () => new Date(),
    async recordConfirmed(items, planFlowId, tx) {
      const timestamp = new Date().toISOString();
      await outbox.enqueue(
        tx,
        items.map((item) => {
          const eventId = `event_${randomUUID()}`;
          return {
            id: eventId,
            schema_version: 1,
            type: 'SchedulePlanned',
            occurred_at: timestamp,
            recorded_at: timestamp,
            source: 'Planning',
            target_refs: {
              scheduleItemId: item.id,
              courseId: item.courseId,
              lessonId: item.lessonId,
              planFlowId,
            },
            payload: { scheduleItemId: item.id, planFlowId, source: 'plan-flow' },
            idempotency_key: eventId,
            correlation_id: eventId,
          } satisfies LearningEventEnvelope;
        }),
      );
    },
  });
  const weeklyReports = createWeeklyReportService({
    repository: weeklyReportRepository,
    factRepository,
    async assembleAdditionalEvidence() {
      const evidence = [];
      for await (const ledger of teachingLedgerRepository.list()) {
        for (const observation of ledger.observations) {
          if (observation.status !== 'active') continue;
          evidence.push({
            factId: `teaching-observation:${observation.observationId}`,
            sourceRef: `teaching-observation:${observation.observationId}`,
            kind: 'teaching-ledger' as const,
            occurredAt: observation.observedAt,
            summary: observation.entries.map((entry) => entry.summary).join('；'),
            payload: {
              scope: observation.scope,
              entries: observation.entries.map((entry) => ({
                kind: entry.kind,
                summary: entry.summary,
                sourceRefs: entry.sourceRefs,
              })),
            },
            courseId: ledger.courseId,
            lessonId: ledger.lessonId,
            actualSeconds: 0,
            topicTags: [],
          });
        }
      }
      for await (const episode of reasoningBehaviorRepository.listEpisodes()) {
        if (episode.status !== 'active') continue;
        evidence.push({
          factId: `reasoning:${episode.episodeId}`,
          sourceRef: `reasoning:${episode.episodeId}`,
          kind: 'reasoning-evidence' as const,
          occurredAt: episode.observedAt,
          summary: episode.behaviorSummary,
          payload: {
            elicitation: episode.elicitation,
            sourceRefs: episode.sourceRefs,
            extractorVersion: episode.extractorVersion,
          },
          courseId: episode.courseId,
          lessonId: episode.lessonId,
          actualSeconds: 0,
          topicTags: [],
        });
      }
      return evidence;
    },
    unitOfWork,
    generationRuntime,
    finalizeArtifact: (input, tx) => artifactStore.stageFinalize(tx, input),
    async recordFinalized(event, tx) {
      const eventId = `event_${randomUUID()}`;
      const timestamp = runtimeNow().toISOString();
      await outbox.enqueue(tx, [
        {
          id: eventId,
          schema_version: 1,
          type: event.type,
          occurred_at: timestamp,
          recorded_at: timestamp,
          source: 'LearningFacts',
          target_refs: { weeklyReportId: event.localWeekKey },
          payload: {
            localWeekKey: event.localWeekKey,
            artifactRef: event.artifactRef,
          },
          idempotency_key: `weekly-report-finalized:${event.localWeekKey}`,
          correlation_id: eventId,
        },
      ]);
    },
    providerId: 'current',
    timeZone: 'Asia/Shanghai',
    now: runtimeNow,
  });
  const weeklyReportScheduler = createWeeklyReportScheduler({
    timeZone: 'Asia/Shanghai',
    hasReport: async (localWeekKey) => {
      const state = (await weeklyReportRepository.get(localWeekKey))?.state;
      return state === 'finalized' || state === 'failed';
    },
    now: runtimeNow,
    async enqueue(command) {
      let report = await weeklyReportRepository.get(command.localWeekKey);
      report ??= await weeklyReports.generate({
        ...command,
        commandId: `generate_weekly_${command.localWeekKey}`,
      });
      if (report.state === 'failed') {
        report = await weeklyReports.retry(
          command.localWeekKey,
          `retry_weekly_${command.localWeekKey}`,
        );
      }
      if (report.state !== 'generating') return;
      const task = await generationExecution.awaitTerminal(report.generationTaskId);
      const markdown = task.draftMarkdown?.trim() ?? '';
      if (task.status !== 'completed' || markdown === '') {
        await weeklyReports.fail(
          command.localWeekKey,
          task.errorCode ?? 'ai_unavailable',
          `draft_${report.generationTaskId}`,
        );
        return;
      }
      await weeklyReports.finalize(command.localWeekKey, report.generationTaskId, markdown);
    },
  });
  await weeklyReportScheduler.start();
  async function facts() {
    await dispatchOutbox();
    const result: LearningFact[] = [];
    for await (const fact of factRepository.list()) result.push(fact);
    return result;
  }
  async function historyView() {
    const projection = createHistoryProjection();
    projection.apply(await facts());
    return projection.view();
  }
  async function courseSummaryView() {
    const projection = createCourseSummaryProjection();
    projection.apply(await facts());
    return projection.view();
  }
  async function statisticsView() {
    const projection = createStatisticsProjection('Asia/Shanghai');
    projection.apply(await facts());
    return projection.view();
  }
  async function calendarView() {
    const projection = createCalendarProjection('Asia/Shanghai');
    projection.apply(await facts());
    return projection.view();
  }
  async function weeklyView() {
    const projection = createWeeklyProjection('Asia/Shanghai');
    projection.apply(await facts());
    return projection.view();
  }
  const evidencePipeline = createProfileEvidencePipeline({
    factRepository,
    repositories: evidenceRepositories,
    unitOfWork,
    extractorVersion: 'facts@1',
    now: runtimeNow,
    nextTransactionId: () => `tx_evidence_${randomUUID()}`,
  });
  let evidenceBarrier: Promise<void> = Promise.resolve();
  async function syncProfileEvidence(): Promise<void> {
    const synchronization = evidenceBarrier.then(async () => {
      await dispatchOutbox();
      let batch;
      do {
        batch = await evidencePipeline.processFacts({ limit: 100 });
      } while (batch.processed > 0);
    });
    evidenceBarrier = synchronization.catch(() => undefined);
    await synchronization;
  }
  function globalProfileWindow() {
    return {
      from: '1970-01-01T00:00:00.000Z',
      to: new Date(runtimeNow().getTime() + 86_400_000).toISOString(),
    };
  }
  async function globalProfile() {
    await syncProfileEvidence();
    return queryGlobalLearningProfile({
      factRepository,
      evidenceRepository: evidenceRepositories.evidence,
      timeZone: 'Asia/Shanghai',
      window: globalProfileWindow(),
    });
  }
  const portraitModule = createPortraitModule({
    repository: portraitRepository,
    evidenceRepository: evidenceRepositories.evidence,
    unitOfWork,
    generationRuntime,
    providerId: 'current',
    nextVersionId: () => `portrait_${randomUUID()}`,
    nextTransactionId: () => `tx_portrait_${randomUUID()}`,
    now: runtimeNow,
    async recordCreated(event, tx) {
      const eventId = `event_${randomUUID()}`;
      const timestamp = runtimeNow().toISOString();
      await outbox.enqueue(tx, [
        {
          id: eventId,
          schema_version: 1,
          type: 'PortraitVersionCommitted',
          occurred_at: timestamp,
          recorded_at: timestamp,
          source: 'LearningPortrait',
          target_refs: { portraitVersionId: event.versionId },
          payload: { manifestId: event.manifestId },
          idempotency_key: `portrait-version:${event.versionId}`,
          correlation_id: eventId,
        },
      ]);
    },
  });
  async function requestPortraitRefresh(input: { idempotencyKey: string; tokenBudget: number }) {
    await profileEvidenceBarrier;
    if (lastProfileEvidenceError !== undefined) {
      throw new Error(`profile_evidence_checkpoint_failed:${lastProfileEvidenceError}`);
    }
    await profileEvidenceAggregator.expire();
    await refreshReasoningBehaviorAnalysis();
    const [profile, reasoningBehaviorAnalysis] = await Promise.all([
      globalProfile(),
      latestUsableReasoningAnalysis(),
    ]);
    const candidates = [];
    for await (const candidate of evidenceRepositories.evidence.list()) candidates.push(candidate);
    const packedEvidence = packPortraitEvidence({
      evidence: candidates,
      tokenBudget: input.tokenBudget,
      dimensionPriority: [],
    });
    const requested = await portraitModule.requestRefresh({
      profileVersion: profile.profileSchemaVersion,
      packedEvidence,
      window: profile.window,
      promptTemplateVersion: 'portrait@1',
      providerConfigFingerprint: createHash('sha256').update('mock').digest('hex'),
      ...(reasoningBehaviorAnalysis === undefined
        ? {}
        : {
            reasoningBehaviorInput: {
              snapshotId: reasoningBehaviorAnalysis.snapshot.snapshotId,
              sourceSnapshotHash: reasoningBehaviorAnalysis.snapshot.sourceSnapshotHash,
              dimensionSetVersion: reasoningBehaviorAnalysis.snapshot.dimensionSetVersion,
            },
          }),
      idempotencyKey: input.idempotencyKey,
    });
    if (requested.state === 'completed' || requested.state === 'failed') return requested;
    if (requested.generationTaskId === undefined) return requested;
    const task = await generationExecution.awaitTerminal(requested.generationTaskId);
    const markdown = task.draftMarkdown?.trim() ?? '';
    if (task.status !== 'completed' || markdown === '') {
      return portraitModule.fail(
        requested.versionId,
        requested.generationTaskId,
        task.errorCode ?? 'ai_unavailable',
        `draft_${requested.generationTaskId}`,
      );
    }
    try {
      return await portraitModule.finalize(
        requested.versionId,
        requested.generationTaskId,
        parseStructuredJson(markdown),
      );
    } catch (error) {
      await portraitModule.fail(
        requested.versionId,
        requested.generationTaskId,
        error instanceof Error ? error.message : 'portrait_output_invalid',
        `draft_${requested.generationTaskId}`,
      );
      throw error;
    }
  }
  async function resolveSession(sessionId: string) {
    let found;
    for await (const record of learningRepositories.list()) {
      if (record.learning.session?.id === sessionId) {
        found = record;
        break;
      }
    }
    if (found === undefined)
      throw Object.assign(new Error('not found'), { code: 'resource_not_found' });
    const lesson = await courseRepositories.lessons.get(found.lessonId);
    if (lesson === undefined)
      throw Object.assign(new Error('not found'), { code: 'resource_not_found' });
    const messages = await messageLog.list(sessionId);
    const completedReviewRefs: string[] = [];
    for await (const record of learningRepositories.list()) {
      if (record.finalReview !== undefined)
        completedReviewRefs.push(record.finalReview.artifactRef);
    }
    return {
      lessonId: found.lessonId,
      sessionId,
      courseId: lesson.courseId,
      lessonDefinitionId: lesson.id,
      outlineVersionId: lesson.outlineVersionId,
      completedReviewRefs,
      currentMessageRefs: messages.map((message) => message.contentArtifactRef),
    };
  }
  await generationRuntime.recoverExpiredLeases();
  // Candidate tasks need the authoring coordinator after execution so their
  // Markdown is compiled and the outline session is advanced. Resume both
  // pending work and terminal tasks whose authoring projection was not saved.
  void (async () => {
    for await (const record of authoringRepositories.outlineSessions.list()) {
      if (record.session.state !== 'generating-candidates') continue;
      const taskId = record.session.activeCandidateTaskId;
      if (taskId === undefined) continue;
      const task = await generationRuntime.get(taskId).catch(() => undefined);
      if (task === undefined) continue;
      try {
        await candidateGeneration.recover({
          outlineSessionId: record.session.outlineSessionId,
          taskId,
        });
      } catch {
        // The task and session retain their durable state for a user-visible retry.
      }
    }
    await generationRuntime.drainQueued();
  })().catch(() => undefined);
  for await (const record of learningRepositories.list()) {
    const sessionId = record.learning.session?.id;
    if (sessionId === undefined || (await messageLog.list(sessionId)).length === 0) continue;
    const lesson = await courseRepositories.lessons.get(record.lessonId);
    if (lesson === undefined) continue;
    const timestamp = runtimeNow().toISOString();
    try {
      await interactiveTeachingRuntime.recoverSession({
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
      });
    } catch {
      teachingProjectionStatus = 'degraded';
    }
  }
  await refreshReasoningBehaviorAnalysis();
  const serverDependencies: ServerDependencies = {
    getRuntimeReadiness: async () => ({
      status:
        teachingProjectionStatus === 'ready' && runtimeProviderStatus === 'ready'
          ? 'ready'
          : 'degraded',
      instanceId: runtimeInstanceId,
      buildId: options.runtimeIdentity?.buildId ?? 'development',
      protocolVersion: options.runtimeIdentity?.protocolVersion ?? '1',
      storeStatus: 'ready',
      projectionStatus: teachingProjectionStatus,
      providerStatus: runtimeProviderStatus,
      ...(teachingProjectionStatus === 'degraded'
        ? { reasonCode: 'teaching_observation_recovery_failed' }
        : {}),
      ...(options.runtimeIdentity === undefined
        ? {}
        : {
            generation: options.runtimeIdentity.generation,
            startedAt: options.runtimeIdentity.startedAt,
            identityFingerprint: options.runtimeIdentity.identityFingerprint,
          }),
    }),
    home: {
      async getHome() {
        const draftSessions = [];
        for await (const record of authoringRepositories.outlineSessions.list()) {
          if (record.session.state === 'confirmed' || record.session.savedAsDraft !== true)
            continue;
          draftSessions.push({
            outlineSessionId: record.session.outlineSessionId,
            topic: record.session.topic,
            courseMode: record.session.courseMode,
            state: record.session.state,
            resourceVersion: record.resourceVersion,
          });
        }
        const courses = [];
        const lessons = [];
        for await (const course of courseRepositories.courses.list()) {
          const confirmedOutline = await courseRepositories.outlineVersions.get(
            course.outlineVersionId,
          );
          courses.push({
            courseId: course.id,
            title: course.title,
            status: course.status,
            courseMode: course.courseMode,
            outlineVersionId: course.outlineVersionId,
            disciplineTag: confirmedOutline?.disciplineTag,
            topicTags: [...(confirmedOutline?.topicTags ?? [])],
            resourceVersion: course.resourceVersion,
          });
          for (const lessonId of course.lessonIds) {
            const [lesson, learning] = await Promise.all([
              courseRepositories.lessons.get(lessonId),
              learningRepositories.get(lessonId),
            ]);
            if (lesson === undefined) continue;
            const lastActivityAt = latestLearningActivityAt(learning?.intervals ?? []);
            const recommendation = course.nextLessonRecommendation;
            const recommendationRank =
              recommendation === undefined ? -1 : recommendation.rankedLessonIds.indexOf(lessonId);
            lessons.push({
              courseId: course.id,
              lessonId,
              title: lesson.title,
              objective: lesson.objective,
              coreKnowledgePoints: [...lesson.coreKnowledgePoints],
              estimatedMinutes: lesson.estimatedMinutes,
              progress: learning?.learning.progress ?? 'not_started',
              ...(learning?.learning.session?.id === undefined
                ? {}
                : { sessionId: learning.learning.session.id }),
              recommended: lessonId === course.recommendedLessonId && recommendationRank <= 0,
              ...(recommendation === undefined || recommendationRank < 0
                ? {}
                : {
                    recommendation: {
                      versionId: recommendation.versionId,
                      rank: recommendationRank + 1,
                      rationale: recommendation.rationale,
                      evidenceRefs: [...recommendation.evidenceRefs],
                      confidence: recommendation.confidence,
                      expiresAt: recommendation.expiresAt,
                      status: recommendation.status,
                      warnings: [...recommendation.warnings],
                    },
                  }),
              ...(lastActivityAt === undefined ? {} : { lastActivityAt }),
            });
          }
        }
        const schedule = (await planning.list())
          .filter((item) => item.status === 'scheduled')
          .map((item) => ({
            scheduleItemId: item.id,
            courseId: item.courseId,
            lessonId: item.lessonId,
            startAt: item.startAt,
            endAt: item.endAt,
            source: item.source,
            locked: item.locked ?? false,
          }));
        return {
          generatedAt: runtimeNow().toISOString(),
          draftSessions,
          courses,
          lessons,
          schedule,
        };
      },
    },
    courseAuthoring: {
      module: courseAuthoring,
      async ingestMaterial(outlineSessionId, input, context) {
        const session = await authoringRepositories.outlineSessions.get(outlineSessionId);
        if (session === undefined) {
          throw Object.assign(new Error('resource_not_found'), { code: 'resource_not_found' });
        }
        if (context.expectedVersion !== session.resourceVersion) {
          throw new RepositoryVersionConflictError(session.resourceVersion);
        }
        const ingested = await ingestSelectedMaterial(
          { fileName: input.fileName, mediaType: input.mediaType, bytes: input.bytes },
          { now: runtimeNow },
        );
        if (!ingested.valid) {
          throw Object.assign(new Error(ingested.code), { code: ingested.code });
        }
        const artifactRef = `material:${outlineSessionId}:${ingested.snapshot.sha256}`;
        const existing = await authoringRepositories.materials.get(artifactRef);
        if (existing === undefined) {
          await unitOfWork.execute({ transactionId: `tx_material_${context.commandId}` }, (tx) =>
            authoringRepositories.materials.save(
              tx,
              {
                ...ingested.snapshot,
                artifactRef,
                outlineSessionId,
                resourceVersion: 0,
              },
              0,
            ),
          );
        }
        return {
          outlineSessionId,
          artifactRef,
          originalFileName: ingested.snapshot.originalFileName,
          format: ingested.snapshot.format,
          sha256: ingested.snapshot.sha256,
          importedAt: ingested.snapshot.importedAt,
          sections: ingested.snapshot.sections.map((section) => ({ ...section })),
          warnings: [...ingested.snapshot.warnings],
          resourceVersion: session.resourceVersion,
        };
      },
      nextCommandId: () => `command_${randomUUID()}`,
      nextCorrelationId: () => `correlation_${randomUUID()}`,
      now: () => new Date(),
    },
    learningSession: {
      module: sessionModule,
      teaching: interactiveTeachingRuntime.module,
      resolveSession,
      async getTeachingProgress(sessionId) {
        const reference = await resolveSession(sessionId);
        const facts = await teachingContextSources.getCourseAndLesson({
          courseId: reference.courseId,
          lessonId: reference.lessonId,
        });
        let state: TeachingStateSnapshot | undefined;
        try {
          state = await interactiveTeachingRuntime.module.getTeachingState(sessionId);
        } catch (error) {
          if (!(error instanceof Error) || error.message !== 'teaching_state_not_found')
            throw error;
        }
        const stateByRef = new Map(state?.knowledgePoints.map((point) => [point.ref, point]));
        return {
          ledgerVersion: state?.ledgerVersion ?? 0,
          observationStatus: state?.observationStatus ?? 'current',
          lessonPhase: state?.lessonPhase ?? 'warmup',
          ...(state?.activeKnowledgePointRef === undefined
            ? facts.lesson.coreKnowledgePoints[0] === undefined
              ? {}
              : { activeKnowledgePointRef: facts.lesson.coreKnowledgePoints[0].ref }
            : { activeKnowledgePointRef: state.activeKnowledgePointRef }),
          comprehensiveCheck: state?.comprehensiveCheck ?? 'pending',
          summaryStatus: state?.summaryStatus ?? 'pending',
          knowledgePoints: facts.lesson.coreKnowledgePoints.map((knowledgePoint) => {
            const point = stateByRef.get(knowledgePoint.ref);
            return {
              ref: knowledgePoint.ref,
              title: knowledgePoint.text,
              progress:
                point?.progress ??
                (point?.verification === 'supporting'
                  ? ('passed' as const)
                  : point?.delivery === 'explained'
                    ? ('checking' as const)
                    : ('pending' as const)),
              delivery: point?.delivery ?? ('not_addressed' as const),
              verification: point?.verification ?? ('not_observed' as const),
              unresolvedQuestionCount: point?.unresolvedEntryRefs.length ?? 0,
            };
          }),
        };
      },
      async saveUserMessage(messageId, markdown) {
        await artifactStore.saveDraft(messageId, markdown);
        return messageId;
      },
      async loadArtifactMarkdown(artifactRef) {
        return (
          (await artifactStore.read(artifactRef))?.content ??
          (await artifactStore.readDraft(artifactRef))
        );
      },
      listSessionMessages: (sessionId) => messageLog.list(sessionId),
      async getLessonEntryState(lessonId) {
        await assertLessonWritable(lessonId);
        const record = await learningRepositories.get(lessonId);
        if (record === undefined) {
          return { lessonId, progress: 'not_started', resourceVersion: 0 };
        }
        const stageReviewId = record.learning.session?.stageReviewId;
        const stageReviewMarkdown =
          stageReviewId === undefined
            ? undefined
            : (await artifactStore.read(`lesson_review_${stageReviewId}`))?.content;
        return {
          lessonId,
          progress: record.learning.progress,
          ...(record.learning.session?.id === undefined
            ? {}
            : { sessionId: record.learning.session.id }),
          ...(stageReviewMarkdown === undefined ? {} : { stageReviewMarkdown }),
          resourceVersion: record.resourceVersion,
        };
      },
      async getLessonRecord(lessonId) {
        const record = await learningRepositories.get(lessonId);
        const sessionId = record?.learning.session?.id;
        if (record === undefined || sessionId === undefined || record.finalReview === undefined) {
          throw Object.assign(new Error('not found'), { code: 'resource_not_found' });
        }
        const [lesson, messages] = await Promise.all([
          courseRepositories.lessons.get(lessonId),
          messageLog.list(sessionId),
        ]);
        if (lesson === undefined) {
          throw Object.assign(new Error('not found'), { code: 'resource_not_found' });
        }
        const course = await courseRepositories.courses.get(lesson.courseId);
        if (course === undefined) {
          throw Object.assign(new Error('not found'), { code: 'resource_not_found' });
        }
        const originalMessages = await Promise.all(
          messages.map(async (message) => {
            const markdown =
              (await artifactStore.read(message.contentArtifactRef))?.content ??
              (await artifactStore.readDraft(message.contentArtifactRef));
            return {
              id: message.id,
              role: message.role,
              markdown: markdown ?? '',
            };
          }),
        );
        const supplementary = [];
        for await (const session of supplementarySessions.listByLesson(lessonId)) {
          const sessionMessages = await Promise.all(
            session.messageIds.map(async (messageId) => {
              const markdown =
                (await artifactStore.read(messageId))?.content ??
                (await artifactStore.readDraft(messageId));
              return {
                id: messageId,
                role: 'user' as const,
                markdown: markdown ?? '',
              };
            }),
          );
          supplementary.push({
            sessionId: session.id,
            label: `补充学习 ${supplementary.length + 1}`,
            createdAt: session.createdAt,
            messages: sessionMessages,
          });
        }
        const finalReviewMarkdown =
          (await artifactStore.read(record.finalReview.artifactRef))?.content ?? '';
        return {
          lessonId,
          courseId: lesson.courseId,
          title: lesson.title,
          courseTitle: course.title,
          completedAt: record.finalReview.committedAt,
          actualSeconds: actualLearningSeconds(record.intervals),
          original: { sessionId, label: '原始学习', messages: originalMessages },
          supplementary,
          finalReviewMarkdown,
        };
      },
      nextCommandId: () => `command_${randomUUID()}`,
      nextCorrelationId: () => `correlation_${randomUUID()}`,
      nextMessageId: () => `message_${randomUUID()}`,
      now: () => new Date(),
      supplementary: {
        async execute(command) {
          const session = await supplementarySessions.execute(command);
          if (command.type === 'ArchiveSupplementarySession') {
            await captureSupplementaryProfileCheckpoint(session);
          }
          return session;
        },
        get: supplementarySessions.get,
      },
    },
    reviewClosure: {
      services: {
        async abandonLesson(lessonId, _sourceSnapshotHash, context) {
          const before = await learningRepositories.get(lessonId);
          const sessionId = before?.learning.session?.id;
          let checkpointSourceHash = '0'.repeat(64);
          if (sessionId !== undefined && (await messageLog.list(sessionId)).length > 0) {
            await interactiveTeachingRuntime.drainObservations(sessionId);
            const state = await interactiveTeachingRuntime.module.getTeachingState(sessionId);
            const checkpoint = await interactiveTeachingRuntime.module.freezeCheckpoint({
              sessionId,
              reason: state.evidenceCheckpoint ? 'evidenced_abandon' : 'manual_pause',
            });
            await captureTeachingProfileCheckpoint(checkpoint);
            await refreshReasoningBehaviorAnalysis();
            checkpointSourceHash = checkpoint.sourceSnapshotHash;
          }
          const result = await abandonLesson(
            { lessonId, sourceSnapshotHash: checkpointSourceHash },
            context,
            {
              sessionModule,
              stageReviews,
            },
          );
          if (result.stageReview === undefined) return result;
          const generated = await reviewWriter.complete(result.stageReview.taskId);
          const markdown = generated.markdown;
          const artifactRef = `lesson_review_${result.stageReview.reviewId}`;
          await artifactStore.finalize({
            artifactId: artifactRef,
            kind: 'lesson-stage-review',
            content: markdown,
            immutable: false,
          });
          await stageReviews.commit({
            reviewId: result.stageReview.reviewId,
            taskId: result.stageReview.taskId,
            artifactRef,
            contentSha256: generated.contentSha256,
          });
          const reviewedLesson = await courseRepositories.lessons.get(lessonId);
          if (reviewedLesson !== undefined) {
            await captureReviewProfileCheckpoint({
              checkpointKind: 'stage_review_finalized',
              sourceRef: `review:${result.stageReview.reviewId}`,
              markdown,
              courseId: reviewedLesson.courseId,
              lessonId,
              observedAt: runtimeNow().toISOString(),
            });
          }
          const view = await sessionModule.query(
            { type: 'GetLessonLearning', lessonId },
            {
              correlationId: context.correlationId,
              actor: context.actor,
              requestedAt: context.requestedAt,
              receivedAt: context.receivedAt,
            },
          );
          return { ...result, resourceVersion: view.resourceVersion };
        },
        restoreLesson: (lessonId, context) =>
          sessionModule
            .execute({ type: 'RestoreLesson', lessonId }, context)
            .then((result) => result.value),
        async beginLessonClosure(lessonId, body, context) {
          const current = await learningRepositories.get(lessonId);
          const sessionId = current?.learning.session?.id;
          if (current === undefined || sessionId === undefined || sessionId !== body.sessionId) {
            throw Object.assign(new Error('resource_not_found'), { code: 'resource_not_found' });
          }
          await interactiveTeachingRuntime.drainObservations(sessionId);
          const checkpoint = await interactiveTeachingRuntime.module.freezeCheckpoint({
            sessionId,
            reason: 'lesson_closure',
          });
          if (
            checkpoint.observationCompleteness !== 'complete' ||
            !checkpoint.teachingState.evidenceCheckpoint ||
            (checkpoint.teachingState.lessonPhase !== undefined &&
              checkpoint.teachingState.lessonPhase !== 'ready_to_close') ||
            checkpoint.retentionDecision !== 'preserve'
          ) {
            throw Object.assign(new Error('lesson_not_completable'), {
              code: 'lesson_not_completable',
            });
          }
          await captureTeachingProfileCheckpoint(checkpoint);
          await refreshReasoningBehaviorAnalysis();
          const closure = await lessonClosures.begin({
            lessonId,
            sessionId,
            sourceSessionIds: [sessionId],
            sourceMessageIds: [...checkpoint.sourceMessageIds],
            messageRangeChecksum: checkpoint.sourceSnapshotHash,
            endIntent: body.endIntent,
            expectedSessionVersion: current.resourceVersion,
          });
          const generated = await reviewWriter.complete(closure.generationTaskId);
          const checksum = checkpoint.sourceSnapshotHash;
          const artifactRef = `lesson_review_${reviewIdForLesson(lessonId)}`;
          await artifactStore.finalize({
            artifactId: artifactRef,
            kind: 'lesson-final-review',
            content: generated.markdown,
            immutable: true,
          });
          await lessonClosures.markReviewReady(closure.transactionId, {
            artifactRef,
            markdown: generated.markdown,
            sourceSessionIds: [sessionId],
            messageRangeChecksum: checksum,
            contentSha256: generated.contentSha256,
          });
          const committed = await lessonClosures.commit(closure.transactionId, checksum, context);
          const lesson = await courseRepositories.lessons.get(lessonId);
          if (lesson !== undefined) {
            await captureReviewProfileCheckpoint({
              checkpointKind: 'lesson_review_finalized',
              sourceRef: `review:${reviewIdForLesson(lessonId)}`,
              markdown: generated.markdown,
              courseId: lesson.courseId,
              lessonId,
              observedAt: runtimeNow().toISOString(),
            });
            await refreshNextLessonRecommendation(lesson.courseId, 'lesson-completed', lessonId);
          }
          return committed;
        },
        async closeCourse(courseId, confirmAbandoned, context) {
          const course = await courseRepositories.courses.get(courseId);
          if (course === undefined)
            throw Object.assign(new Error('not found'), { code: 'resource_not_found' });
          const completedFinalReviewRefs: string[] = [];
          const abandonedStageReviewRefs: string[] = [];
          const abandonedWithoutReviewLessonIds: string[] = [];
          for (const lessonId of course.lessonIds) {
            const record = await learningRepositories.get(lessonId);
            if (record?.finalReview !== undefined)
              completedFinalReviewRefs.push(record.finalReview.artifactRef);
            else if (
              record?.learning.progress === 'abandoned' &&
              record.learning.session?.stageReviewId !== undefined
            )
              abandonedStageReviewRefs.push(record.learning.session.stageReviewId);
            else if (record?.learning.progress === 'abandoned')
              abandonedWithoutReviewLessonIds.push(lessonId);
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
              repositories: courseRepositories,
              unitOfWork,
              getLessonState: async (lessonId) =>
                (await learningRepositories.get(lessonId))?.learning.progress ?? 'not_started',
              inputManifest,
              outbox,
              now: () => new Date(),
              nextEventId: () => `event_${randomUUID()}`,
            },
          );
          const existingReview = await reviewClosureRepositories.courseReviews.get(courseId);
          if (existingReview?.state === 'review-finalized') {
            const markdown =
              existingReview.artifactRef === undefined
                ? undefined
                : (await artifactStore.read(existingReview.artifactRef))?.content;
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
          await artifactStore.finalize({
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
            observedAt: runtimeNow().toISOString(),
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
          if (closure === undefined)
            throw Object.assign(new Error('not found'), { code: 'resource_not_found' });
          return closure;
        },
        async retryClosure(transactionId, context) {
          const retried = await lessonClosures.retry(transactionId, context.commandId);
          const generated = await reviewWriter.complete(retried.generationTaskId);
          const artifactRef = `lesson_review_${reviewIdForLesson(retried.lessonId)}`;
          await artifactStore.finalize({
            artifactId: artifactRef,
            kind: 'lesson-final-review',
            content: generated.markdown,
            immutable: true,
          });
          await lessonClosures.markReviewReady(retried.transactionId, {
            artifactRef,
            markdown: generated.markdown,
            sourceSessionIds: retried.sourceSessionIds,
            messageRangeChecksum: retried.messageRangeChecksum,
            contentSha256: generated.contentSha256,
          });
          const committed = await lessonClosures.commit(
            retried.transactionId,
            retried.messageRangeChecksum,
            context,
          );
          const lesson = await courseRepositories.lessons.get(retried.lessonId);
          if (lesson !== undefined) {
            await captureReviewProfileCheckpoint({
              checkpointKind: 'lesson_review_finalized',
              sourceRef: `review:${reviewIdForLesson(retried.lessonId)}`,
              markdown: generated.markdown,
              courseId: lesson.courseId,
              lessonId: retried.lessonId,
              observedAt: runtimeNow().toISOString(),
            });
            await refreshNextLessonRecommendation(
              lesson.courseId,
              'lesson-completed',
              retried.lessonId,
            );
          }
          return committed;
        },
        async getCourseReview(courseId) {
          const review = await reviewClosureRepositories.courseReviews.get(courseId);
          if (review === undefined) return undefined;
          const markdown =
            review.artifactRef === undefined
              ? undefined
              : (await artifactStore.read(review.artifactRef))?.content;
          return { ...review, ...(markdown === undefined ? {} : { markdown }) };
        },
      },
      nextCommandId: () => `command_${randomUUID()}`,
      nextCorrelationId: () => `correlation_${randomUUID()}`,
      now: () => new Date(),
    },
    planning: {
      planning: {
        execute: planning.execute,
        list: planning.list,
      },
      planFlows: {
        requestPreview: planFlows.requestPreview,
        confirm: planFlows.confirm,
        get: planFlows.get,
        manage: planFlows.manage,
      },
      nextCommandId: () => `command_${randomUUID()}`,
      nextCorrelationId: () => `correlation_${randomUUID()}`,
      now: () => new Date(),
    },
    learningFacts: {
      queries: {
        getHistory: historyView,
        getCourseSummary: courseSummaryView,
        getStatistics: statisticsView,
        getCalendar: calendarView,
        getWeekly: weeklyView,
        async getWeeklyReport(localWeekKey) {
          const report = await weeklyReportRepository.get(localWeekKey);
          if (report === undefined) return undefined;
          const markdown =
            report.artifactRef === undefined
              ? undefined
              : (await artifactStore.read(report.artifactRef))?.content;
          return { ...report, ...(markdown === undefined ? {} : { markdown }) };
        },
      },
    },
    profile: {
      getGlobalProfile: globalProfile,
      async listEvidence() {
        await syncProfileEvidence();
        const evidence = [];
        for await (const candidate of evidenceRepositories.evidence.list()) {
          evidence.push(candidate);
        }
        return evidence;
      },
      async listReasoningEpisodes() {
        const episodes = [];
        for await (const episode of reasoningBehaviorRepository.listEpisodes()) {
          episodes.push(episode);
        }
        return episodes;
      },
      refreshReasoningAnalysis: refreshAndProjectReasoningAnalysis,
      getReasoningAnalysis: (snapshotId) => reasoningBehaviorModule.getAnalysis(snapshotId),
    },
    portraits: {
      requestRefresh: requestPortraitRefresh,
      async getCurrent() {
        const cursor = await portraitRepository.getCurrent();
        if (cursor !== undefined) {
          const [portrait, reasoningBehaviorAnalysis] = await Promise.all([
            portraitRepository.getVersion(cursor.currentVersionId),
            latestUsableReasoningAnalysis(),
          ]);
          return portrait === undefined
            ? undefined
            : {
                ...portrait,
                ...(reasoningBehaviorAnalysis === undefined
                  ? {}
                  : {
                      reasoningBehaviorAnalysis: {
                        snapshot: reasoningBehaviorAnalysis.snapshot,
                        dimensions: reasoningBehaviorAnalysis.dimensions,
                      },
                    }),
              };
        }
        const refresh = await readPortraitRefreshState(dataRoot);
        return refresh === undefined
          ? undefined
          : {
              state: refresh.state,
              errorCode: refresh.errorCode,
              retryable: refresh.state === 'failed',
              updatedAt: refresh.updatedAt,
            };
      },
      async getVersion(versionId) {
        const [portrait, reasoningBehaviorAnalysis] = await Promise.all([
          portraitRepository.getVersion(versionId),
          latestUsableReasoningAnalysis(),
        ]);
        return portrait === undefined
          ? undefined
          : {
              ...portrait,
              ...(reasoningBehaviorAnalysis === undefined
                ? {}
                : {
                    reasoningBehaviorAnalysis: {
                      snapshot: reasoningBehaviorAnalysis.snapshot,
                      dimensions: reasoningBehaviorAnalysis.dimensions,
                    },
                  }),
            };
      },
      nextCorrelationId: () => `correlation_${randomUUID()}`,
    },
    generationFrameLog: frameLog,
    runtimeControl: {
      switchProvider: providerConfigService.switchProvider,
      getProviderStatus: providerConfigService.getStatus,
      reconnectProvider: providerConfigService.reconnect,
      getProviderCatalog: generationRuntime.getProviderCatalog,
      startProviderAuthentication: async (providerId) => ({
        state: await generationRuntime.startProviderAuthentication(providerId),
      }),
      ...(options.createDiagnostics === undefined
        ? {}
        : { createDiagnostics: options.createDiagnostics }),
      nextCorrelationId: () => `correlation_${randomUUID()}`,
    },
    localSecurity: {
      allowedOrigin: options.allowedOrigin ?? 'http://127.0.0.1:5173',
      csrfToken: options.csrfToken,
    },
  };
  return {
    close: async () => weeklyReportScheduler.stop(),
    serverDependencies,
    courseRepositories,
    frameLog,
    dataRoot,
    generationRuntime,
    providerConfigService,
  };
}
