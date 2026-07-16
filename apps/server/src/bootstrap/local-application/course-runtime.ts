import { randomUUID } from 'node:crypto';

import type { CourseAuthoringRouteOptions } from '../../http/routes/course-authoring.js';
import { createCandidateGenerationCoordinator } from '../../modules/course-authoring/implementation/candidate-generation-coordinator.js';
import { createCourseArchiveDeletion } from '../../modules/course-authoring/implementation/course-archive-deletion.js';
import { createCourseAuthoringFacade } from '../../modules/course-authoring/implementation/course-authoring-facade.js';
import { createCourseAuthoringModule } from '../../modules/course-authoring/implementation/course-authoring-module.js';
import { createGenerationAuthoringAgent } from '../../modules/course-authoring/implementation/generation-authoring-agent.js';
import { createGenerationCandidateAlignmentPlanner } from '../../modules/course-authoring/implementation/generation-candidate-alignment-planner.js';
import { ingestSelectedMaterial } from '../../modules/course-authoring/implementation/material-ingestion.js';
import {
  createLocalFileCourseArchiveStore,
  createLocalFileOutlineSessionDraftStore,
  stagePortraitRefreshState,
} from '../../persistence/course-archive-store.js';
import { createLocalFileCourseAuthoringRepositories } from '../../persistence/course-authoring-repositories.js';
import { createLocalFileCourseCreationRepositories } from '../../persistence/course-creation-repositories.js';
import type { DataRoot } from '../../persistence/data-root.js';
import { createMarkdownArtifactStore } from '../../persistence/markdown-artifact-store.js';
import { RepositoryVersionConflictError } from '../../persistence/repository-errors.js';
import type { UnitOfWork } from '../../persistence/unit-of-work.js';
import type { LocalEventFactsRuntime } from './event-facts-runtime.js';
import type { LocalGenerationRuntime } from './generation-runtime.js';
import type { LocalProfileRuntime } from './profile-runtime.js';
import { resolveCourseTitle } from '../../modules/course-authoring/model/course-title.js';

type CourseRepositories = ReturnType<typeof createLocalFileCourseCreationRepositories>;
type AuthoringRepositories = ReturnType<typeof createLocalFileCourseAuthoringRepositories>;

export type CourseAccess = Readonly<{
  getCourse: CourseRepositories['courses']['get'];
  getLesson: CourseRepositories['lessons']['get'];
  getOutlineVersion: CourseRepositories['outlineVersions']['get'];
  getMaterial: AuthoringRepositories['materials']['get'];
  listCourses: CourseRepositories['courses']['list'];
  listLessons: CourseRepositories['lessons']['listByCourse'];
  listDraftSessions: AuthoringRepositories['outlineSessions']['list'];
  saveCourse: CourseRepositories['courses']['save'];
  assertCourseWritable(courseId: string): Promise<void>;
  assertLessonWritable(lessonId: string): Promise<void>;
}>;

export type LocalCourseRuntime = Readonly<{
  routes: CourseAuthoringRouteOptions;
  access: CourseAccess;
  courseRepositories: CourseRepositories;
  recoverGenerationTasks(): Promise<void>;
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

  async function getCourseWithOutlineTitle(courseId: string) {
    const course = await courseRepositories.courses.get(courseId);
    if (course === undefined) return undefined;
    const outline = await courseRepositories.outlineVersions.get(course.outlineVersionId);
    if (outline === undefined) return course;
    return {
      ...course,
      title: resolveCourseTitle(outline.outlineMarkdown, course.title),
    };
  }

  async function* listCoursesWithOutlineTitle() {
    for await (const course of courseRepositories.courses.list()) {
      const outline = await courseRepositories.outlineVersions.get(course.outlineVersionId);
      yield outline === undefined
        ? course
        : {
            ...course,
            title: resolveCourseTitle(outline.outlineMarkdown, course.title),
          };
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
    outbox: input.events.outbox,
    profileEvidenceSink: input.profile.checkpointSink,
    nextId,
    now: () => new Date(),
    courseArchiveDeletion,
    outlineSessionDraftStore: createLocalFileOutlineSessionDraftStore(input.dataRoot),
  });

  const routes: CourseAuthoringRouteOptions = {
    module: courseAuthoring,
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
      listCourses: listCoursesWithOutlineTitle,
      listLessons: (courseId) => courseRepositories.lessons.listByCourse(courseId),
      listDraftSessions: () => authoringRepositories.outlineSessions.list(),
      saveCourse: (tx, course, expectedVersion) =>
        courseRepositories.courses.save(tx, course, expectedVersion),
      assertCourseWritable,
      assertLessonWritable,
    },
    courseRepositories,
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
  };
}
