import { createHash, randomUUID } from 'node:crypto';

import {
  type LearningEventEnvelope,
  type TeachingCheckpointSnapshot,
  type TeachingStateSnapshot,
} from '@learning-more/contracts';

import type { LearningSessionRouteOptions } from '../../http/routes/learning-sessions.js';
import { createTeachingContextAssembler } from '../../modules/interactive-teaching/implementation/context-assembler.js';
import { createGenerationTeachingAgent } from '../../modules/interactive-teaching/implementation/generation-teaching-agent.js';
import { createGenerationTeachingObserver } from '../../modules/interactive-teaching/implementation/generation-teaching-observer.js';
import { createInteractiveTeaching } from '../../modules/interactive-teaching/implementation/interactive-teaching.js';
import { teachingPlayIntent } from '../../modules/interactive-teaching/implementation/teaching-play-intent.js';
import type { TeachingContextSources } from '../../modules/interactive-teaching/ports/teaching-context-sources.js';
import type { AdditionalWeeklyEvidence } from '../../modules/learning-facts/implementation/weekly-evidence-assembler.js';
import { createLocalFileMessageLog } from '../../modules/learning-session/implementation/message-log.js';
import { createSessionModule } from '../../modules/learning-session/implementation/session-module.js';
import { createSupplementarySessionModule } from '../../modules/learning-session/implementation/supplementary-session-module.js';
import { actualLearningSeconds } from '../../modules/learning-session/implementation/time-intervals.js';
import type { DataRoot } from '../../persistence/data-root.js';
import { createLocalFileLearningSessionRepositories } from '../../persistence/learning-session-repositories.js';
import { createMarkdownArtifactStore } from '../../persistence/markdown-artifact-store.js';
import { createLocalFileSupplementarySessionRepository } from '../../persistence/supplementary-session-repository.js';
import { createLocalFileTeachingLedgerRepository } from '../../persistence/teaching-ledger-repositories.js';
import type { UnitOfWork } from '../../persistence/unit-of-work.js';
import type { LocalCourseRuntime } from './course-runtime.js';
import type { LocalEventFactsRuntime } from './event-facts-runtime.js';
import type { LocalGenerationRuntime } from './generation-runtime.js';
import type { LocalProfileRuntime } from './profile-runtime.js';

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
  listWeeklyTeachingEvidence(): Promise<readonly AdditionalWeeklyEvidence[]>;
  recoverTeachingSessions(): Promise<void>;
  getProjectionStatus(): 'ready' | 'degraded';
}>;

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
  }>,
): LocalLearningRuntime {
  const learningRepositories = createLocalFileLearningSessionRepositories(input.dataRoot);
  const messageLog = createLocalFileMessageLog(input.dataRoot);
  const supplementaryRepository = createLocalFileSupplementarySessionRepository(input.dataRoot);
  const teachingLedgerRepository = createLocalFileTeachingLedgerRepository(input.dataRoot);
  let projectionStatus: 'ready' | 'degraded' = 'ready';
  const teachingRecoveryBySession = new Map<string, Promise<void>>();

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
        } else if (event.type === 'FinalReviewCommitted') {
          append('ReviewFinalized', { reviewId: event.reviewId, reviewType: 'final' });
          append('LessonSessionCompleted', {
            sessionId,
            reviewId: event.reviewId,
            actualSeconds: actualLearningSeconds(record.intervals),
          });
        }
      }
      await input.events.outbox.enqueue(tx, publicEvents);
    },
  });

  const teachingContextSources: TeachingContextSources = {
    async getCourseAndLesson({ courseId, lessonId }) {
      const [course, lesson] = await Promise.all([
        input.course.access.getCourse(courseId),
        input.course.access.getLesson(lessonId),
      ]);
      if (course === undefined || lesson === undefined || lesson.courseId !== course.id) {
        throw Object.assign(new Error('resource_not_found'), { code: 'resource_not_found' });
      }
      const lessonMap = [];
      for await (const candidate of input.course.access.listLessons(courseId)) {
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
            (await input.artifactStore.read(message.contentArtifactRef))?.content ??
            (await input.artifactStore.readDraft(message.contentArtifactRef)) ??
            '',
          sourceRef: `message:${message.id}`,
        })),
      );
    },
    async listRelevantFinalReviews(courseId, lessonId) {
      const reviews = [];
      for await (const lesson of input.course.access.listLessons(courseId)) {
        if (lesson.id === lessonId) continue;
        const learning = await learningRepositories.get(lesson.id);
        if (learning?.finalReview === undefined) continue;
        const markdown = (await input.artifactStore.read(learning.finalReview.artifactRef))
          ?.content;
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
      const lesson = await input.course.access.getLesson(lessonId);
      if (lesson === undefined) return [];
      const excerpts = [];
      for (const sourceRef of lesson.sourceRefs) {
        const material = await input.course.access.getMaterial(sourceRef);
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
    getPersonalizationView: input.profile.getTeachingPersonalization,
  };
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
  });
  const supplementarySessions = createSupplementarySessionModule({
    repository: supplementaryRepository,
    unitOfWork: input.unitOfWork,
    async getCompletedLesson(lessonId) {
      const learning = await learningRepositories.get(lessonId);
      if (learning?.learning.progress !== 'completed' || learning.finalReview === undefined) {
        return undefined;
      }
      const lesson = await input.course.access.getLesson(lessonId);
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
    input.profile.checkpointSink.capture({
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

  async function captureSupplementaryProfileCheckpoint(
    session: NonNullable<Awaited<ReturnType<typeof supplementarySessions.get>>>,
  ): Promise<void> {
    const sourceGroupId = `supplementary:${session.id}`;
    const sources = (
      await Promise.all(
        session.messageIds.slice(-64).map(async (messageId) => {
          const excerpt =
            (await input.artifactStore.read(messageId))?.content ??
            (await input.artifactStore.readDraft(messageId));
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
    const lesson = await input.course.access.getLesson(session.lessonId);
    const course = await input.course.access.getCourse(session.courseId);
    const learning = await learningRepositories.get(session.lessonId);
    const dependentSourceGroupIds =
      learning?.learning.session?.id === undefined
        ? []
        : [`lesson:${session.lessonId}:session:${learning.learning.session.id}`];
    input.profile.checkpointSink.capture({
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

  async function resolveSession(sessionId: string) {
    let found;
    for await (const record of learningRepositories.list()) {
      if (record.learning.session?.id === sessionId) {
        found = record;
        break;
      }
    }
    if (found === undefined) {
      throw Object.assign(new Error('not found'), { code: 'resource_not_found' });
    }
    const lesson = await input.course.access.getLesson(found.lessonId);
    if (lesson === undefined) {
      throw Object.assign(new Error('not found'), { code: 'resource_not_found' });
    }
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

  const routes: LearningSessionRouteOptions = {
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
        if (!(error instanceof Error) || error.message !== 'teaching_state_not_found') throw error;
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
        closureInquiry: state?.closureInquiry ?? 'pending',
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
      const stageReviewId = record.learning.session?.stageReviewId;
      const stageReviewMarkdown =
        stageReviewId === undefined
          ? undefined
          : (await input.artifactStore.read(`lesson_review_${stageReviewId}`))?.content;
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
      const originalMessages = await Promise.all(
        messages.map(async (message) => {
          const markdown =
            (await input.artifactStore.read(message.contentArtifactRef))?.content ??
            (await input.artifactStore.readDraft(message.contentArtifactRef));
          return { id: message.id, role: message.role, markdown: markdown ?? '' };
        }),
      );
      const supplementary = [];
      for await (const session of supplementarySessions.listByLesson(lessonId)) {
        const sessionMessages = await Promise.all(
          session.messageIds.map(async (messageId) => {
            const markdown =
              (await input.artifactStore.read(messageId))?.content ??
              (await input.artifactStore.readDraft(messageId));
            return { id: messageId, role: 'user' as const, markdown: markdown ?? '' };
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
        (await input.artifactStore.read(record.finalReview.artifactRef))?.content ?? '';
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
    async listWeeklyTeachingEvidence() {
      const evidence: AdditionalWeeklyEvidence[] = [];
      for await (const ledger of teachingLedgerRepository.list()) {
        for (const observation of ledger.observations) {
          if (observation.status !== 'active') continue;
          evidence.push({
            factId: `teaching-observation:${observation.observationId}`,
            sourceRef: `teaching-observation:${observation.observationId}`,
            kind: 'teaching-ledger',
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
      return evidence;
    },
    async recoverTeachingSessions() {
      for await (const record of learningRepositories.list()) {
        const sessionId = record.learning.session?.id;
        if (sessionId === undefined || (await messageLog.list(sessionId)).length === 0) continue;
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
          .catch(() => {
            projectionStatus = 'degraded';
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
