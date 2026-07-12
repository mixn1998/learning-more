import { createHash, randomUUID } from 'node:crypto';

import { EVENT_TYPES, type LearningEventEnvelope } from '@learning-more/contracts';

import { createMockProvider, type MockProviderStep } from '../ai-providers/mock-provider.js';
import { createCandidateGenerationCoordinator } from '../modules/course-authoring/implementation/candidate-generation-coordinator.js';
import { createCourseAuthoringFacade } from '../modules/course-authoring/implementation/course-authoring-facade.js';
import { createCourseAuthoringModule } from '../modules/course-authoring/implementation/course-authoring-module.js';
import { closeCourse as closeCourseAggregate } from '../modules/course-authoring/implementation/close-course.js';
import { createGenerationFrameLog } from '../modules/generation-runtime/implementation/frame-log.js';
import { createGenerationRuntime } from '../modules/generation-runtime/implementation/generation-runtime.js';
import { createLocalFileMessageLog } from '../modules/learning-session/implementation/message-log.js';
import { createSessionGenerationCoordinator } from '../modules/learning-session/implementation/session-generation.js';
import { createSessionModule } from '../modules/learning-session/implementation/session-module.js';
import { createSupplementarySessionModule } from '../modules/learning-session/implementation/supplementary-session-module.js';
import { abandonLesson } from '../modules/learning-session/implementation/abandon-lesson.js';
import { createFactProjector } from '../modules/learning-facts/implementation/fact-projector.js';
import type { LearningFact } from '../modules/learning-facts/interface.js';
import { createCalendarProjection } from '../modules/learning-facts/implementation/projections/calendar.js';
import { createCourseSummaryProjection } from '../modules/learning-facts/implementation/projections/course-summary.js';
import { createHistoryProjection } from '../modules/learning-facts/implementation/projections/history.js';
import { createStatisticsProjection } from '../modules/learning-facts/implementation/projections/statistics.js';
import { createWeeklyProjection } from '../modules/learning-facts/implementation/projections/weekly.js';
import { createPlanFlowService } from '../modules/planning/implementation/plan-flow-service.js';
import { createPlanningModule } from '../modules/planning/implementation/planning-module.js';
import { createCourseReviewWorkflow } from '../modules/review-closure/implementation/course-review.js';
import { createLessonClosureWorkflow } from '../modules/review-closure/implementation/lesson-closure.js';
import {
  createStageReviewWorkflow,
  reviewIdForLesson,
} from '../modules/review-closure/implementation/stage-review.js';
import { createLocalFileCourseAuthoringRepositories } from '../persistence/course-authoring-repositories.js';
import { createLocalFileCourseCreationRepositories } from '../persistence/course-creation-repositories.js';
import { DataRoot } from '../persistence/data-root.js';
import { createEventDispatcher } from '../persistence/event-dispatcher.js';
import { createEventLog } from '../persistence/event-log.js';
import { createLocalFileRepositories } from '../persistence/local-file-repositories.js';
import { createLocalFileLearningSessionRepositories } from '../persistence/learning-session-repositories.js';
import { createLocalFileFactRepository } from '../persistence/learning-facts-repositories.js';
import { createMarkdownArtifactStore } from '../persistence/markdown-artifact-store.js';
import { createOutbox } from '../persistence/outbox.js';
import { createStorePaths, initializeStoreLayout } from '../persistence/paths.js';
import {
  createLocalFilePlanFlowRepository,
  createLocalFileScheduleRepository,
} from '../persistence/planning-repositories.js';
import { recoverTransactions } from '../persistence/recover-transactions.js';
import { createLocalFileReviewClosureRepositories } from '../persistence/review-closure-repositories.js';
import { createLocalFileSupplementarySessionRepository } from '../persistence/supplementary-session-repository.js';
import { createUnitOfWork } from '../persistence/unit-of-work.js';
import { createLocalFileWeeklyReportRepository } from '../persistence/weekly-report-repositories.js';
import type { ServerDependencies } from './app.js';

function candidateMarkdown(version: number): string {
  return `\`\`\`learning-more-outline
{"courseGoals":["Understand probability"],"disciplineTag":"mathematics","topicTags":["probability"],"lessons":[{"id":"probability-space","title":"Probability spaces","objective":"Understand sample spaces","coreKnowledgePoints":["sample space"],"prerequisiteLessonIds":[],"estimatedMinutes":30,"sourceRefs":["source_topic"]},{"id":"random-variable","title":"Random variables","objective":"Model outcomes","coreKnowledgePoints":["random variable"],"prerequisiteLessonIds":["probability-space"],"estimatedMinutes":45,"sourceRefs":["source_topic"]}]}
\`\`\`
# Candidate outline ${version}

1. Probability spaces
2. Random variables`;
}

function mockScript(attempt: number, failOnce: boolean): readonly MockProviderStep[] {
  if (failOnce && attempt === 1) {
    return [
      { type: 'text', text: '# Partial candidate' },
      { type: 'fail', error: new Error('mock_provider_interrupted') },
    ];
  }
  return [{ type: 'text', text: candidateMarkdown(attempt) }];
}

export async function createLocalApplication(options: {
  readonly dataRoot: string;
  readonly csrfToken: string;
  readonly allowedOrigin?: string;
  readonly mockFailOnce?: boolean;
}) {
  const dataRoot = DataRoot.create(options.dataRoot);
  await initializeStoreLayout(createStorePaths(dataRoot));
  await recoverTransactions(dataRoot);
  const unitOfWork = createUnitOfWork({ dataRoot });
  const runtimeInstanceId = `instance_${randomUUID()}`;
  const authoringRepositories = createLocalFileCourseAuthoringRepositories(dataRoot);
  const courseRepositories = createLocalFileCourseCreationRepositories(dataRoot);
  const localRepositories = createLocalFileRepositories(dataRoot);
  const frameLog = createGenerationFrameLog(dataRoot);
  const provider = createMockProvider({
    id: 'mock',
    scriptFactory: (attempt) => mockScript(attempt, options.mockFailOnce ?? false),
  });
  const generationRuntime = createGenerationRuntime({
    repository: localRepositories.generationTasks,
    unitOfWork,
    providers: [provider],
    nextId: () => `task_${randomUUID()}`,
  });
  const artifactStore = createMarkdownArtifactStore(dataRoot, unitOfWork);
  const authoringModule = createCourseAuthoringModule({
    repositories: authoringRepositories,
    unitOfWork,
    generationRuntime,
    providerId: 'mock',
    draftStore: artifactStore,
  });
  const candidateGeneration = createCandidateGenerationCoordinator({
    module: authoringModule,
    repositories: authoringRepositories,
    runtime: generationRuntime,
    frameLog,
    nextCandidateId: () => `candidate_${randomUUID()}`,
  });
  const eventLog = createEventLog(dataRoot);
  const eventDispatcher = createEventDispatcher();
  const factRepository = createLocalFileFactRepository(dataRoot);
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
  await outbox.dispatchPending(10_000);
  const nextId = (kind: 'session' | 'course' | 'event' | 'outline' | 'adjustment') =>
    `${kind}_${randomUUID()}`;
  const courseAuthoring = createCourseAuthoringFacade({
    authoring: authoringRepositories,
    courses: courseRepositories,
    unitOfWork,
    candidateGeneration,
    outbox,
    assessmentStore: artifactStore,
    nextId,
    now: () => new Date(),
  });
  const learningRepositories = createLocalFileLearningSessionRepositories(dataRoot);
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
  });
  const sessionGeneration = createSessionGenerationCoordinator({
    runtime: generationRuntime,
    sessionModule,
    frameLog,
    artifactStore: {
      saveDraft: artifactStore.saveDraft,
      async saveManifest(manifest) {
        const content = JSON.stringify(manifest);
        const id = `manifest_${createHash('sha256').update(content).digest('hex')}`;
        await artifactStore.saveDraft(id, content);
        return id;
      },
    },
    providerId: 'mock',
    nextMessageId: () => `message_${randomUUID()}`,
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
  const stageReviews = createStageReviewWorkflow({
    repository: reviewClosureRepositories.stageReviews,
    unitOfWork,
    generationRuntime,
    providerId: 'mock',
    now: () => new Date(),
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
    generationRuntime,
    nextTransactionId: () => `closure_${randomUUID()}`,
    nextReviewId: reviewIdForLesson,
    now: () => new Date(),
  });
  const courseReviews = createCourseReviewWorkflow({
    repository: reviewClosureRepositories.courseReviews,
    unitOfWork,
    generationRuntime,
    outbox,
    nextEventId: () => `event_${randomUUID()}`,
    now: () => new Date(),
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
    isLessonCompleted: async (lessonId) =>
      (await learningRepositories.get(lessonId))?.learning.progress === 'completed',
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
    generationRuntime,
    getScheduleVersion: scheduleVersion,
    lessonExists: async (lessonId) =>
      (await courseRepositories.lessons.get(lessonId)) !== undefined,
    nextPlanFlowId: () => `plan_flow_${randomUUID()}`,
    nextScheduleItemId: () => `schedule_${randomUUID()}`,
    now: () => new Date(),
    providerId: 'mock',
  });
  async function facts() {
    await outbox.dispatchPending(10_000);
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
  const serverDependencies: ServerDependencies = {
    getRuntimeReadiness: async () => ({
      status: 'ready',
      instanceId: runtimeInstanceId,
      buildId: 'development',
      protocolVersion: '1',
      storeStatus: 'ready',
      projectionStatus: 'ready',
      providerStatus: 'ready',
    }),
    courseAuthoring: {
      module: courseAuthoring,
      nextCommandId: () => `command_${randomUUID()}`,
      nextCorrelationId: () => `correlation_${randomUUID()}`,
      now: () => new Date(),
    },
    learningSession: {
      module: sessionModule,
      generation: sessionGeneration,
      resolveSession,
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
      nextCommandId: () => `command_${randomUUID()}`,
      nextCorrelationId: () => `correlation_${randomUUID()}`,
      nextMessageId: () => `message_${randomUUID()}`,
      now: () => new Date(),
      supplementary: supplementarySessions,
    },
    reviewClosure: {
      services: {
        async abandonLesson(lessonId, sourceSnapshotHash, context) {
          const result = await abandonLesson({ lessonId, sourceSnapshotHash }, context, {
            sessionModule,
            stageReviews,
          });
          if (result.stageReview === undefined) return result;
          await generationRuntime.cancel(result.stageReview.taskId);
          const markdown = '# Stage Review\nLearning preserved for restoration.';
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
            contentSha256: createHash('sha256').update(markdown).digest('hex'),
          });
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
          const closure = await lessonClosures.begin({
            lessonId,
            ...body,
            expectedSessionVersion: context.expectedVersion ?? 0,
          });
          await generationRuntime.cancel(closure.generationTaskId);
          const checksum = body.messageRangeChecksum;
          const artifactRef = `lesson_review_${reviewIdForLesson(lessonId)}`;
          await artifactStore.finalize({
            artifactId: artifactRef,
            kind: 'lesson-final-review',
            content: '# Final Review\nLearning completed.',
            immutable: true,
          });
          await lessonClosures.markReviewReady(closure.transactionId, {
            artifactRef,
            markdown: '# Final Review\nLearning completed.',
            sourceSessionIds: body.sourceSessionIds,
            messageRangeChecksum: checksum,
            contentSha256: createHash('sha256')
              .update('# Final Review\nLearning completed.')
              .digest('hex'),
          });
          return lessonClosures.commit(closure.transactionId, checksum, context);
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
            return {
              ...existingReview,
              transactionId: courseId,
              resourceVersion: closed.resourceVersion,
            };
          }
          const pendingReview = await courseReviews.request(
            courseId,
            inputManifest,
            context.commandId,
          );
          if (pendingReview.generationTaskId !== undefined) {
            await generationRuntime.cancel(pendingReview.generationTaskId);
          }
          const courseReviewArtifactRef = `course_review_${courseId}`;
          const courseReviewMarkdown = '# Course Review\nCourse learning summary completed.';
          await artifactStore.finalize({
            artifactId: courseReviewArtifactRef,
            kind: 'course-review',
            content: courseReviewMarkdown,
            immutable: true,
          });
          await courseReviews.markReady(
            courseId,
            courseReviewArtifactRef,
            createHash('sha256').update(courseReviewMarkdown).digest('hex'),
          );
          const review = await courseReviews.finalize(courseId, context.idempotencyKey);
          return { ...review, transactionId: courseId, resourceVersion: closed.resourceVersion };
        },
        async getClosure(transactionId) {
          const closure = await lessonClosureRepository.get(transactionId);
          if (closure === undefined)
            throw Object.assign(new Error('not found'), { code: 'resource_not_found' });
          return closure;
        },
        retryClosure: (transactionId, context) =>
          lessonClosures.retry(transactionId, context.commandId),
        getCourseReview: (courseId) => reviewClosureRepositories.courseReviews.get(courseId),
      },
      nextCommandId: () => `command_${randomUUID()}`,
      nextCorrelationId: () => `correlation_${randomUUID()}`,
      now: () => new Date(),
    },
    planning: {
      planning,
      planFlows,
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
        getWeeklyReport: (localWeekKey) => weeklyReportRepository.get(localWeekKey),
      },
    },
    generationFrameLog: frameLog,
    localSecurity: {
      allowedOrigin: options.allowedOrigin ?? 'http://127.0.0.1:5173',
      csrfToken: options.csrfToken,
    },
  };
  return { serverDependencies, courseRepositories, frameLog, dataRoot };
}
