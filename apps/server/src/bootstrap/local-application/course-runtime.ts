import { randomUUID } from 'node:crypto';

import type { CourseAuthoringRouteOptions } from '../../http/routes/course-authoring.js';
import { createCandidateGenerationCoordinator } from '../../modules/course-authoring/implementation/candidate-generation-coordinator.js';
import { createCourseArchiveDeletion } from '../../modules/course-authoring/implementation/course-archive-deletion.js';
import { createCourseAuthoringFacade } from '../../modules/course-authoring/implementation/course-authoring-facade.js';
import { createCourseAuthoringModule } from '../../modules/course-authoring/implementation/course-authoring-module.js';
import { createGenerationAuthoringAgent } from '../../modules/course-authoring/implementation/generation-authoring-agent.js';
import { createGenerationCandidateAlignmentPlanner } from '../../modules/course-authoring/implementation/generation-candidate-alignment-planner.js';
import { ingestSelectedMaterial } from '../../modules/course-authoring/implementation/material-ingestion.js';
import { createOutlineRevisionCleanup } from '../../modules/planning/implementation/outline-revision-cleanup.js';
import {
  createTeachingWeightService,
  teachingWeightStatus,
} from '../../modules/course-authoring/implementation/teaching-weight-service.js';
import {
  createLocalFileCourseArchiveStore,
  createLocalFileOutlineSessionDraftStore,
  stagePortraitRefreshState,
} from '../../persistence/course-archive-store.js';
import { createLocalFileCourseAuthoringRepositories } from '../../persistence/course-authoring-repositories.js';
import { createLocalFileCourseCreationRepositories } from '../../persistence/course-creation-repositories.js';
import { createLocalFileTeachingWeightRepository } from '../../persistence/teaching-weight-repository.js';
import { createLocalFileLearningSessionRepositories } from '../../persistence/learning-session-repositories.js';
import type { DataRoot } from '../../persistence/data-root.js';
import { createMarkdownArtifactStore } from '../../persistence/markdown-artifact-store.js';
import {
  createLocalFilePlanFlowRepository,
  createLocalFileScheduleRepository,
} from '../../persistence/planning-repositories.js';
import { RepositoryVersionConflictError } from '../../persistence/repository-errors.js';
import type { UnitOfWork } from '../../persistence/unit-of-work.js';
import type { LocalEventFactsRuntime } from './event-facts-runtime.js';
import type { LocalGenerationRuntime } from './generation-runtime.js';
import type { LocalProfileRuntime } from './profile-runtime.js';

type CourseRepositories = ReturnType<typeof createLocalFileCourseCreationRepositories>;
type AuthoringRepositories = ReturnType<typeof createLocalFileCourseAuthoringRepositories>;

export type CourseAccess = Readonly<{
  getCourse: CourseRepositories['courses']['get'];
  getLesson: CourseRepositories['lessons']['get'];
  getOutlineVersion: CourseRepositories['outlineVersions']['get'];
  getMaterial: AuthoringRepositories['materials']['get'];
  getTeachingWeightMetadata: ReturnType<typeof createLocalFileTeachingWeightRepository>['get'];
  listCourses: CourseRepositories['courses']['list'];
  listAllLessons: CourseRepositories['lessons']['list'];
  listLessons: CourseRepositories['lessons']['listByCourse'];
  listDraftSessions: AuthoringRepositories['outlineSessions']['list'];
  saveCourse: CourseRepositories['courses']['save'];
  assertCourseWritable(courseId: string): Promise<void>;
  assertLessonWritable(lessonId: string): Promise<void>;
  assertLessonStartable(lessonId: string): Promise<void>;
}>;

export type LocalCourseRuntime = Readonly<{
  routes: CourseAuthoringRouteOptions;
  access: CourseAccess;
  courseRepositories: CourseRepositories;
  reconcileOutlineLiveReferences(): Promise<void>;
  recoverInterruptedAuthoringTurns(): Promise<void>;
  recoverGenerationTasks(): Promise<void>;
  recoverTeachingWeightMetadata(): Promise<void>;
}>;

export function createLocalCourseRuntime(
  input: Readonly<{
    dataRoot: DataRoot;
    unitOfWork: UnitOfWork;
    artifactStore: ReturnType<typeof createMarkdownArtifactStore>;
    now: () => Date;
    generation: LocalGenerationRuntime;
    events: LocalEventFactsRuntime;
    profile: LocalProfileRuntime;
  }>,
): LocalCourseRuntime {
  const authoringRepositories = createLocalFileCourseAuthoringRepositories(input.dataRoot);
  const courseRepositories = createLocalFileCourseCreationRepositories(input.dataRoot);
  const scheduleRepository = createLocalFileScheduleRepository(input.dataRoot);
  const planFlowRepository = createLocalFilePlanFlowRepository(input.dataRoot);
  const teachingWeightRepository = createLocalFileTeachingWeightRepository(input.dataRoot);
  const learningSessionRepositories = createLocalFileLearningSessionRepositories(input.dataRoot);
  const listCurrentLessons = async function* (courseId: string) {
    const course = await courseRepositories.courses.get(courseId);
    if (course === undefined) return;
    const lessons = await Promise.all(
      course.lessonIds.map((lessonId) => courseRepositories.lessons.get(lessonId)),
    );
    for (const lesson of lessons) {
      if (lesson !== undefined && lesson.courseId === courseId) yield lesson;
    }
  };
  const isLessonCompleted = async (lessonId: string) =>
    (await learningSessionRepositories.get(lessonId))?.learning.progress === 'completed';
  const listCompletedLessonOutlineContexts = async (courseId: string) => {
    const course = await courseRepositories.courses.get(courseId);
    if (course === undefined) return [];
    const lessons = [];
    for await (const lesson of listCurrentLessons(courseId)) {
      if (await isLessonCompleted(lesson.id)) lessons.push(lesson);
    }
    const activeOrder = new Map(course.lessonIds.map((lessonId, index) => [lessonId, index]));
    lessons.sort(
      (left, right) =>
        (activeOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
          (activeOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER) || left.id.localeCompare(right.id),
    );
    return lessons.map((lesson) => ({
      lessonId: lesson.id,
      semanticKey: lesson.semanticKey,
      title: lesson.title,
      objective: lesson.objective,
      coreKnowledgePoints: lesson.coreKnowledgePoints,
    }));
  };
  const teachingWeights = createTeachingWeightService({
    courses: courseRepositories,
    repository: teachingWeightRepository,
    unitOfWork: input.unitOfWork,
    execution: input.generation.execution,
    providerId: 'current',
    now: input.now,
  });
  const outlineRevisionLiveCleanup = createOutlineRevisionCleanup({
    schedules: scheduleRepository,
    planFlows: planFlowRepository,
    async recordScheduleCancelled(event, tx) {
      const eventId = `event_${randomUUID()}`;
      await input.events.outbox.enqueue(tx, [
        {
          id: eventId,
          schema_version: 1,
          type: 'ScheduleCancelled',
          occurred_at: event.occurredAt,
          recorded_at: event.occurredAt,
          source: 'Planning',
          target_refs: {
            scheduleItemId: event.scheduleItemId,
            courseId: event.courseId,
            lessonId: event.lessonId,
          },
          payload: {
            scheduleItemId: event.scheduleItemId,
            cancelReason: event.reason,
          },
          idempotency_key: `outline-revised:${event.scheduleItemId}:${event.occurredAt}`,
          correlation_id: eventId,
        },
      ]);
    },
  });

  async function getCourseWithOutlineTitle(courseId: string) {
    const course = await courseRepositories.courses.get(courseId);
    return course;
  }

  async function* listCoursesWithOutlineTitle() {
    for await (const course of courseRepositories.courses.list()) {
      yield course;
    }
  }

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

  async function assertLessonStartable(lessonId: string): Promise<void> {
    const lesson = await courseRepositories.lessons.get(lessonId);
    if (lesson === undefined) {
      throw Object.assign(new Error('resource_not_found'), { code: 'resource_not_found' });
    }
    const course = await courseRepositories.courses.get(lesson.courseId);
    if (course === undefined || !course.lessonIds.includes(lessonId)) {
      throw Object.assign(new Error('lesson_not_current'), { code: 'lesson_not_current' });
    }
  }

  const authoringModule = createCourseAuthoringModule({
    repositories: authoringRepositories,
    unitOfWork: input.unitOfWork,
    generationRuntime: input.generation.runtime,
    providerId: 'current',
    draftStore: input.artifactStore,
  });
  const candidateGeneration = createCandidateGenerationCoordinator({
    module: authoringModule,
    repositories: authoringRepositories,
    runtime: input.generation.runtime,
    execution: input.generation.execution,
    frameLog: input.generation.frameLog,
    nextCandidateId: () => `candidate_${randomUUID()}`,
    listCompletedLessonOutlineContexts,
  });
  const nextId = (kind: 'session' | 'course' | 'event' | 'outline' | 'adjustment' | 'message') =>
    `${kind}_${randomUUID()}`;
  const courseArchiveDeletion = createCourseArchiveDeletion({
    store: createLocalFileCourseArchiveStore(input.dataRoot),
    unitOfWork: input.unitOfWork,
    outbox: input.events.outbox,
    async requestPortraitRefresh({ courseId, idempotencyKey }) {
      try {
        await input.profile.requestPortraitRefresh({ idempotencyKey, tokenBudget: 8_000 });
        await input.unitOfWork.execute(
          { transactionId: `tx_portrait_refresh_state_${randomUUID()}` },
          (tx) => stagePortraitRefreshState(tx, undefined),
        );
      } catch (error) {
        await input.unitOfWork.execute(
          { transactionId: `tx_portrait_refresh_state_${randomUUID()}` },
          (tx) =>
            stagePortraitRefreshState(tx, {
              schemaVersion: 1,
              state: 'failed',
              reason: 'course_deleted',
              courseId,
              updatedAt: input.now().toISOString(),
              errorCode: 'portrait_refresh_failed',
            }),
        );
        throw error;
      }
    },
    nextEventId: () => `event_${randomUUID()}`,
    now: input.now,
  });
  const courseAuthoring = createCourseAuthoringFacade({
    authoring: authoringRepositories,
    courses: courseRepositories,
    unitOfWork: input.unitOfWork,
    candidateGeneration,
    authoringAgent: createGenerationAuthoringAgent({
      execution: input.generation.execution,
      providerId: 'current',
    }),
    candidateAlignmentPlanner: createGenerationCandidateAlignmentPlanner({
      execution: input.generation.execution,
      providerId: 'current',
    }),
    nextLessonRecommender: input.generation.nextLessonRecommender,
    isLessonCompleted,
    listCompletedLessonOutlineContexts,
    outlineRevisionLiveCleanup,
    outbox: input.events.outbox,
    profileEvidenceSink: input.profile.checkpointSink,
    async onOutlineVersionPublished({ courseId }) {
      await teachingWeights.ensureForCourse(courseId);
    },
    nextId,
    now: () => new Date(),
    courseArchiveDeletion,
    outlineSessionDraftStore: createLocalFileOutlineSessionDraftStore(input.dataRoot),
  });

  const getLessonPreview = courseAuthoring.getLesson;
  if (getLessonPreview === undefined) throw new Error('lesson_query_not_configured');
  const courseAuthoringWithTeachingWeights = {
    ...courseAuthoring,
    async getLesson(lessonId: string, context: Parameters<typeof getLessonPreview>[1]) {
      const preview = await getLessonPreview(lessonId, context);
      const metadata = await teachingWeights.get(preview.outlineVersionId);
      const status = teachingWeightStatus(metadata);
      const keyIndexes = new Set(
        status === 'completed'
          ? metadata?.keyKnowledgePoints
              .filter((point) => point.lessonId === preview.lessonId)
              .map((point) => point.knowledgePointIndex)
          : [],
      );
      return {
        ...preview,
        teachingWeightStatus: status,
        knowledgePointWeights: preview.coreKnowledgePoints.map((_, index) =>
          keyIndexes.has(index) ? ('key' as const) : ('normal' as const),
        ),
      };
    },
  };

  const routes: CourseAuthoringRouteOptions = {
    module: courseAuthoringWithTeachingWeights,
    async ingestMaterial(outlineSessionId, materialInput, context) {
      const session = await authoringRepositories.outlineSessions.get(outlineSessionId);
      if (session === undefined) {
        throw Object.assign(new Error('resource_not_found'), { code: 'resource_not_found' });
      }
      if (context.expectedVersion !== session.resourceVersion) {
        throw new RepositoryVersionConflictError(session.resourceVersion);
      }
      const ingested = await ingestSelectedMaterial(
        {
          fileName: materialInput.fileName,
          mediaType: materialInput.mediaType,
          bytes: materialInput.bytes,
        },
        { now: input.now },
      );
      if (!ingested.valid) {
        throw Object.assign(new Error(ingested.code), { code: ingested.code });
      }
      const artifactRef = `material:${outlineSessionId}:${ingested.snapshot.sha256}`;
      const existing = await authoringRepositories.materials.get(artifactRef);
      if (existing === undefined) {
        await input.unitOfWork.execute(
          { transactionId: `tx_material_${context.commandId}` },
          (tx) =>
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
  };

  return {
    routes,
    access: {
      getCourse: getCourseWithOutlineTitle,
      getLesson: (lessonId) => courseRepositories.lessons.get(lessonId),
      getOutlineVersion: (outlineVersionId) =>
        courseRepositories.outlineVersions.get(outlineVersionId),
      getMaterial: (sourceRef) => authoringRepositories.materials.get(sourceRef),
      getTeachingWeightMetadata: (outlineVersionId) => teachingWeights.get(outlineVersionId),
      listCourses: listCoursesWithOutlineTitle,
      listAllLessons: () => courseRepositories.lessons.list(),
      listLessons: listCurrentLessons,
      listDraftSessions: () => authoringRepositories.outlineSessions.list(),
      saveCourse: (tx, course, expectedVersion) =>
        courseRepositories.courses.save(tx, course, expectedVersion),
      assertCourseWritable,
      assertLessonWritable,
      assertLessonStartable,
    },
    courseRepositories,
    async reconcileOutlineLiveReferences() {
      for await (const course of courseRepositories.courses.list()) {
        const knownCourseLessonIds: string[] = [];
        for await (const lesson of courseRepositories.lessons.listByCourse(course.id)) {
          knownCourseLessonIds.push(lesson.id);
        }
        await input.unitOfWork.execute(
          {
            transactionId: `tx_outline_live_reconcile_${course.id}_${course.outlineVersionId}`,
          },
          (tx) =>
            outlineRevisionLiveCleanup.retireOutlineReferences(
              {
                courseId: course.id,
                retainedLessonIds: course.lessonIds,
                knownCourseLessonIds,
                commandId: `outline-live-reconcile:${course.outlineVersionId}`,
                occurredAt: input.now().toISOString(),
              },
              tx,
            ),
        );
      }
    },
    recoverInterruptedAuthoringTurns: () => courseAuthoring.recoverInterruptedTurns(),
    async recoverGenerationTasks() {
      for await (const record of authoringRepositories.outlineSessions.list()) {
        if (record.session.state !== 'generating-candidates') continue;
        const taskId = record.session.activeCandidateTaskId;
        if (taskId === undefined) continue;
        const task = await input.generation.runtime.get(taskId).catch(() => undefined);
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
      await input.generation.runtime.drainQueued();
    },
    async recoverTeachingWeightMetadata() {
      for await (const course of courseRepositories.courses.list()) {
        const metadata = await teachingWeightRepository.get(course.outlineVersionId);
        if (teachingWeightStatus(metadata) === 'completed') continue;
        await teachingWeights.ensureForCourse(course.id).catch(() => undefined);
      }
    },
  };
}
