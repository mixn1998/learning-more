import { randomUUID } from 'node:crypto';

import { ScheduleViewResponseSchema, type LearningEventEnvelope } from '@learning-more/contracts';

import type { PlanningRouteOptions } from '../../http/routes/planning.js';
import { createPlanFlowService } from '../../modules/planning/implementation/plan-flow-service.js';
import { createPlanningModule } from '../../modules/planning/implementation/planning-module.js';
import { createScheduleIndex } from '../../modules/planning/implementation/schedule-index.js';
import type { DataRoot } from '../../persistence/data-root.js';
import { createMarkdownArtifactStore } from '../../persistence/markdown-artifact-store.js';
import {
  createLocalFilePlanFlowRepository,
  createLocalFileScheduleRepository,
} from '../../persistence/planning-repositories.js';
import type { UnitOfWork } from '../../persistence/unit-of-work.js';
import type { ReadRevisionTracker } from '../../persistence/read-revision.js';
import { createSummarySnapshot } from '../../persistence/summary-snapshot.js';
import type { LocalCourseRuntime } from './course-runtime.js';
import type { LocalEventFactsRuntime } from './event-facts-runtime.js';
import type { LocalLearningRuntime } from './learning-runtime.js';

export type PlanningAccess = Readonly<{
  listSchedule: ReturnType<typeof createPlanningModule>['list'];
  getScheduleVersion(): Promise<number>;
}>;

export type LocalPlanningRuntime = Readonly<{
  routes: PlanningRouteOptions;
  access: PlanningAccess;
}>;

export function createLocalPlanningRuntime(
  input: Readonly<{
    dataRoot: DataRoot;
    unitOfWork: UnitOfWork;
    artifactStore: ReturnType<typeof createMarkdownArtifactStore>;
    course: LocalCourseRuntime;
    learning: LocalLearningRuntime;
    events: LocalEventFactsRuntime;
    readRevision: ReadRevisionTracker;
  }>,
): LocalPlanningRuntime {
  const scheduleRepository = createLocalFileScheduleRepository(input.dataRoot);
  const planFlowRepository = createLocalFilePlanFlowRepository(input.dataRoot);
  const scheduleIndex = createScheduleIndex({
    repository: scheduleRepository,
    revision: () => input.readRevision.current(['schedule']),
  });

  async function scheduleVersion(): Promise<number> {
    return (await scheduleIndex.current()).resourceVersion;
  }

  async function currentLesson(lessonId: string) {
    const lesson = await input.course.access.getLesson(lessonId);
    if (lesson === undefined) return undefined;
    const course = await input.course.access.getCourse(lesson.courseId);
    if (course === undefined || !course.lessonIds.includes(lessonId)) return undefined;
    return lesson;
  }

  const planning = createPlanningModule({
    repository: scheduleRepository,
    scheduleIndex,
    unitOfWork: input.unitOfWork,
    async getLessonProgress(lessonId) {
      const lesson = await currentLesson(lessonId);
      if (lesson === undefined) return undefined;
      return (await input.learning.access.getRecord(lessonId))?.learning.progress ?? 'not_started';
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
      await input.events.outbox.enqueue(tx, [envelope]);
    },
  });
  const planFlows = createPlanFlowService({
    repository: planFlowRepository,
    scheduleRepository,
    scheduleIndex,
    unitOfWork: input.unitOfWork,
    async assemblePreviewContext(previewInput) {
      const courses = [];
      for (const courseId of previewInput.courseRefs) {
        const course = await input.course.access.getCourse(courseId);
        if (course !== undefined) {
          courses.push({
            courseId: course.id,
            title: course.title,
            lessonIds: course.lessonIds,
          });
        }
      }
      const lessons = [];
      for (const lessonId of previewInput.lessonRefs) {
        const lesson = await currentLesson(lessonId);
        if (lesson !== undefined) {
          lessons.push({
            lessonId: lesson.id,
            courseId: lesson.courseId,
            title: lesson.title,
            objective: lesson.objective,
            prerequisiteLessonIds: lesson.prerequisiteLessonIds,
            estimatedMinutes: lesson.estimatedMinutes,
            progress:
              (await input.learning.access.getRecord(lesson.id))?.learning.progress ??
              'not_started',
          });
        }
      }
      const existingSchedule = [];
      for await (const item of scheduleRepository.list()) {
        if (item.status === 'scheduled' && (await currentLesson(item.lessonId)) !== undefined) {
          existingSchedule.push(item);
        }
      }
      const constraints = await input.artifactStore.read(previewInput.constraintsArtifactRef);
      const preference = (prefix: string) =>
        previewInput.timeWindowRefs.find((ref) => ref.startsWith(prefix))?.slice(prefix.length);
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
        declaredTimeWindows: previewInput.timeWindowRefs,
        constraintsMarkdown: constraints?.content,
        existingSchedule,
        fixedCommitments: existingSchedule.filter((item) => item.locked === true),
      };
    },
    getScheduleVersion: scheduleVersion,
    lessonIsPlannable: async (lessonId) => {
      if ((await currentLesson(lessonId)) === undefined) return false;
      const progress = (await input.learning.access.getRecord(lessonId))?.learning.progress;
      return progress !== 'completed' && progress !== 'abandoned';
    },
    getLessonPrerequisiteIds: async (lessonId) =>
      (await currentLesson(lessonId))?.prerequisiteLessonIds ?? [],
    getCourseLessonIds: async (courseId) =>
      (await input.course.access.getCourse(courseId))?.lessonIds ?? [],
    nextPlanFlowId: () => `plan_flow_${randomUUID()}`,
    nextScheduleItemId: () => `schedule_${randomUUID()}`,
    now: () => new Date(),
    async recordConfirmed(items, planFlowId, tx) {
      const timestamp = new Date().toISOString();
      await input.events.outbox.enqueue(
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
    async recordScheduleMutation(mutation, planFlowId, tx) {
      const timestamp = new Date().toISOString();
      await input.events.outbox.enqueue(
        tx,
        [
          ...mutation.planned.map((item) => ({ item, type: 'SchedulePlanned' as const })),
          ...mutation.cancelled.map((item) => ({
            item,
            type: 'ScheduleCancelled' as const,
          })),
        ].map(({ item, type }) => {
          const eventId = `event_${randomUUID()}`;
          return {
            id: eventId,
            schema_version: 1,
            type,
            occurred_at: timestamp,
            recorded_at: timestamp,
            source: 'Planning',
            target_refs: {
              scheduleItemId: item.id,
              courseId: item.courseId,
              lessonId: item.lessonId,
              planFlowId,
            },
            payload: {
              scheduleItemId: item.id,
              planFlowId,
              source: 'plan-flow',
              ...(item.cancelReason === undefined ? {} : { reason: item.cancelReason }),
            },
            idempotency_key: eventId,
            correlation_id: eventId,
          } satisfies LearningEventEnvelope;
        }),
      );
    },
  });

  let currentLessonIndex:
    Readonly<{ revision: string; lessonIds: ReadonlySet<string> }> | undefined;
  let currentLessonIndexBuild:
    Readonly<{ revision: string; promise: Promise<ReadonlySet<string>> }> | undefined;

  async function currentCourseLessonIds(): Promise<ReadonlySet<string>> {
    const revision = input.readRevision.current(['catalog']);
    if (currentLessonIndex?.revision === revision) return currentLessonIndex.lessonIds;
    if (currentLessonIndexBuild?.revision === revision) return currentLessonIndexBuild.promise;
    const promise = (async () => {
      const lessonIds = new Set<string>();
      for await (const course of input.course.access.listCourses()) {
        for (const lessonId of course.lessonIds) lessonIds.add(lessonId);
      }
      const currentRevision = input.readRevision.current(['catalog']);
      if (currentRevision !== revision) return currentCourseLessonIds();
      currentLessonIndex = { revision, lessonIds };
      return lessonIds;
    })().finally(() => {
      if (currentLessonIndexBuild?.promise === promise) currentLessonIndexBuild = undefined;
    });
    currentLessonIndexBuild = { revision, promise };
    return promise;
  }

  async function buildCurrentScheduleSnapshot() {
    const [snapshot, currentLessonIds] = await Promise.all([
      planning.snapshot(),
      currentCourseLessonIds(),
    ]);
    return {
      items: snapshot.items.filter((item) => currentLessonIds.has(item.lessonId)),
      resourceVersion: snapshot.resourceVersion,
    };
  }

  type CurrentScheduleSnapshot = Awaited<ReturnType<typeof buildCurrentScheduleSnapshot>>;

  const currentSchedule = createSummarySnapshot<CurrentScheduleSnapshot>({
    dataRoot: input.dataRoot,
    name: 'current-schedule-v1',
    schemaVersion: 1,
    sourceRevision: () => input.readRevision.current(['catalog', 'schedule']),
    parse: (value) => ScheduleViewResponseSchema.parse(value) as CurrentScheduleSnapshot,
    build: buildCurrentScheduleSnapshot,
  });

  async function currentScheduleSnapshot() {
    return (await currentSchedule.current()).value;
  }

  async function listCurrentSchedule() {
    return (await currentScheduleSnapshot()).items;
  }

  return {
    routes: {
      planning: {
        execute: planning.execute,
        clear: planning.clear,
        snapshot: currentScheduleSnapshot,
        list: listCurrentSchedule,
        getVersion: planning.getVersion,
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
    access: {
      listSchedule: listCurrentSchedule,
      getScheduleVersion: scheduleVersion,
    },
  };
}
