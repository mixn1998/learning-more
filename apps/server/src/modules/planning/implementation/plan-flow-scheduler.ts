import type { PlanSuggestion } from '../model/plan-flow.js';
import { overlaps } from '../model/schedule-item.js';
import type { PlanPreviewContext } from './plan-flow-service.js';

const DEFAULT_START_HOUR = 19;
const MAX_DATE_SEARCH_DAYS = 3_660;
const VALID_LEARNING_DAYS = new Set(['周一', '周二', '周三', '周四', '周五', '周六', '周日']);

function addLocalDays(localDate: string, days: number): string {
  const [year, month, day] = localDate.split('-').map(Number) as [number, number, number];
  if (![year, month, day].every(Number.isFinite)) throw new Error('plan_preview_invalid');
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function zonedInstant(localDate: string, timeZone: string, hour: number, minute = 0): string {
  const [year, month, day] = localDate.split('-').map(Number) as [number, number, number];
  const target = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let instant = target;
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(instant)).map((part) => [part.type, part.value]),
    );
    const represented = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
    const adjustment = target - represented;
    instant += adjustment;
    if (adjustment === 0) break;
  }
  return new Date(instant).toISOString();
}

function localDateAt(instant: string, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(new Date(instant))
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function weekdayAt(localDate: string, timeZone: string): string {
  return new Intl.DateTimeFormat('zh-CN', { timeZone, weekday: 'short' }).format(
    new Date(zonedInstant(localDate, timeZone, 12)),
  );
}

type PreviewLesson = PlanPreviewContext['lessons'][number];

type LessonGraph = Readonly<{
  available: Set<string>;
  courseOrder: readonly string[];
  dependents: ReadonlyMap<string, readonly string[]>;
  indegree: Map<string, number>;
  lessons: ReadonlyMap<string, PreviewLesson>;
  position: ReadonlyMap<string, number>;
  remainingByCourse: Map<string, number>;
}>;

function buildLessonGraph(context: PlanPreviewContext, lessonRefs: readonly string[]): LessonGraph {
  const inputPosition = new Map(lessonRefs.map((lessonId, index) => [lessonId, index]));
  if (inputPosition.size !== lessonRefs.length) throw new Error('plan_preview_invalid');
  const lessons = new Map(
    context.lessons
      .filter((lesson) => inputPosition.has(lesson.lessonId))
      .map((lesson) => [lesson.lessonId, lesson]),
  );
  if (lessons.size !== lessonRefs.length) throw new Error('plan_preview_invalid');

  const position = new Map<string, number>();
  for (const course of context.courses) {
    for (const [index, lessonId] of (course.lessonIds ?? []).entries()) {
      if (inputPosition.has(lessonId)) position.set(lessonId, index);
    }
  }
  for (const [lessonId, index] of inputPosition) {
    if (!position.has(lessonId)) position.set(lessonId, index);
  }

  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const lessonId of lessonRefs) {
    const lesson = lessons.get(lessonId)!;
    const dependencies = new Set(
      lesson.prerequisiteLessonIds.filter((prerequisiteId) => lessons.has(prerequisiteId)),
    );
    const outlineOrder = context.courses
      .find((course) => course.courseId === lesson.courseId)
      ?.lessonIds?.filter((candidateId) => lessons.get(candidateId)?.courseId === lesson.courseId);
    const outlineIndex = outlineOrder?.indexOf(lessonId) ?? -1;
    if (outlineOrder !== undefined && outlineIndex > 0) {
      dependencies.add(outlineOrder[outlineIndex - 1]!);
    }
    indegree.set(lessonId, dependencies.size);
    for (const prerequisiteId of dependencies) {
      dependents.set(prerequisiteId, [...(dependents.get(prerequisiteId) ?? []), lessonId]);
    }
  }

  const courseOrder = context.courses
    .map((course) => course.courseId)
    .filter((courseId, index, all) => all.indexOf(courseId) === index);
  for (const lessonId of lessonRefs) {
    const courseId = lessons.get(lessonId)!.courseId;
    if (!courseOrder.includes(courseId)) courseOrder.push(courseId);
  }
  const remainingByCourse = new Map<string, number>();
  for (const lesson of lessons.values()) {
    remainingByCourse.set(lesson.courseId, (remainingByCourse.get(lesson.courseId) ?? 0) + 1);
  }
  return {
    available: new Set(lessonRefs.filter((lessonId) => indegree.get(lessonId) === 0)),
    courseOrder,
    dependents,
    indegree,
    lessons,
    position,
    remainingByCourse,
  };
}

function orderedCandidates(graph: LessonGraph, lessonIds: readonly string[]): PreviewLesson[] {
  return lessonIds
    .map((lessonId) => graph.lessons.get(lessonId)!)
    .sort(
      (left, right) =>
        graph.courseOrder.indexOf(left.courseId) - graph.courseOrder.indexOf(right.courseId) ||
        graph.position.get(left.lessonId)! - graph.position.get(right.lessonId)!,
    );
}

function completeLesson(graph: LessonGraph, lesson: PreviewLesson): void {
  graph.available.delete(lesson.lessonId);
  graph.remainingByCourse.set(lesson.courseId, graph.remainingByCourse.get(lesson.courseId)! - 1);
  for (const dependentId of graph.dependents.get(lesson.lessonId) ?? []) {
    const remaining = graph.indegree.get(dependentId)! - 1;
    graph.indegree.set(dependentId, remaining);
    if (remaining === 0) graph.available.add(dependentId);
  }
}

function nextLearningDate(
  startLocalDate: string,
  learningDays: ReadonlySet<string>,
  timeZone: string,
): string {
  for (let offset = 0; offset < MAX_DATE_SEARCH_DAYS; offset += 1) {
    const candidate = addLocalDays(startLocalDate, offset);
    if (learningDays.size === 0 || learningDays.has(weekdayAt(candidate, timeZone))) {
      return candidate;
    }
  }
  throw new Error('plan_preview_invalid');
}

export function buildPlanSuggestions(
  context: PlanPreviewContext,
  lessonRefs: readonly string[],
): readonly PlanSuggestion[] {
  const startLocalDate = context.availability.startLocalDate;
  const dailyTargetMinutes = context.availability.dailyTargetMinutes;
  if (
    startLocalDate === undefined ||
    dailyTargetMinutes === undefined ||
    !Number.isFinite(dailyTargetMinutes) ||
    dailyTargetMinutes <= 0
  ) {
    throw new Error('plan_preview_invalid');
  }
  if (lessonRefs.length === 0) return [];

  const graph = buildLessonGraph(context, lessonRefs);
  const learningDays = new Set(context.availability.learningDays);
  if (
    learningDays.size === 0 ||
    [...learningDays].some((weekday) => !VALID_LEARNING_DAYS.has(weekday))
  ) {
    throw new Error('plan_preview_invalid');
  }
  const suggestions: PlanSuggestion[] = [];
  const outlinePositions = new Map(
    context.courses.map((course) => [
      course.courseId,
      new Map((course.lessonIds ?? []).map((lessonId, index) => [lessonId, index])),
    ]),
  );
  const usedMinutes = new Map<string, number>();
  let localDate = nextLearningDate(startLocalDate, learningDays, context.timezone);
  let balancedCourseIndex = -1;
  let focusCourseId: string | undefined;

  while (suggestions.length < lessonRefs.length) {
    let used = usedMinutes.get(localDate) ?? 0;
    if (graph.available.size === 0) throw new Error('plan_preview_invalid');
    const remainingCapacity = dailyTargetMinutes - used;
    const fittingLessonIds = [...graph.available].filter(
      (lessonId) =>
        used === 0 || graph.lessons.get(lessonId)!.estimatedMinutes <= remainingCapacity,
    );
    if (fittingLessonIds.length === 0) {
      localDate = nextLearningDate(addLocalDays(localDate, 1), learningDays, context.timezone);
      continue;
    }
    const fitting = orderedCandidates(graph, fittingLessonIds);
    let lesson: PreviewLesson | undefined;

    if (context.userPreferences.strategy === 'balanced') {
      for (let offset = 1; offset <= graph.courseOrder.length; offset += 1) {
        const courseIndex = (balancedCourseIndex + offset) % graph.courseOrder.length;
        const candidate = fitting.find((item) => item.courseId === graph.courseOrder[courseIndex]);
        if (candidate === undefined) continue;
        lesson = candidate;
        balancedCourseIndex = courseIndex;
        break;
      }
    } else if (context.userPreferences.strategy === 'focus') {
      if (focusCourseId === undefined || (graph.remainingByCourse.get(focusCourseId) ?? 0) === 0) {
        focusCourseId = graph.courseOrder.find(
          (courseId) => (graph.remainingByCourse.get(courseId) ?? 0) > 0,
        );
      }
      lesson = fitting.find((item) => item.courseId === focusCourseId);
      if (lesson === undefined) {
        const focusReadyButTooLong = [...graph.available].some(
          (lessonId) => graph.lessons.get(lessonId)!.courseId === focusCourseId,
        );
        if (focusReadyButTooLong && used > 0) {
          localDate = nextLearningDate(addLocalDays(localDate, 1), learningDays, context.timezone);
          continue;
        }
        // A cross-course prerequisite can temporarily interrupt focus mode.
        lesson = fitting[0];
      }
    } else {
      lesson = fitting[0];
    }
    if (lesson === undefined) throw new Error('plan_preview_invalid');

    let startAt = zonedInstant(localDate, context.timezone, DEFAULT_START_HOUR);
    const coursePositions = outlinePositions.get(lesson.courseId);
    const lessonPosition = coursePositions?.get(lesson.lessonId);
    if (lessonPosition !== undefined) {
      const precedingEnd = context.existingSchedule
        .filter(
          (item) =>
            item.status !== 'removed' &&
            item.courseId === lesson.courseId &&
            (coursePositions?.get(item.lessonId) ?? Number.POSITIVE_INFINITY) < lessonPosition,
        )
        .reduce((latest, item) => Math.max(latest, Date.parse(item.endAt)), 0);
      if (precedingEnd > Date.parse(startAt)) {
        const precedingDate = localDateAt(new Date(precedingEnd).toISOString(), context.timezone);
        localDate = nextLearningDate(precedingDate, learningDays, context.timezone);
        startAt = zonedInstant(localDate, context.timezone, DEFAULT_START_HOUR);
        if (localDate === precedingDate && precedingEnd > Date.parse(startAt)) {
          startAt = new Date(precedingEnd).toISOString();
        }
      }
    }
    let endAt = new Date(Date.parse(startAt) + lesson.estimatedMinutes * 60_000).toISOString();
    for (;;) {
      // Schedule intervals are compatibility carriers for a learning date and estimated
      // duration. They are not exclusive calendar slots. Only suggestions created in this
      // preview are sequenced so their outline order remains deterministic; schedules from
      // other courses may intentionally share the same learning date.
      const conflict = suggestions
        .filter((item) => overlaps({ startAt, endAt }, item))
        .sort((left, right) => Date.parse(left.endAt) - Date.parse(right.endAt))[0];
      if (conflict === undefined) break;
      startAt = conflict.endAt;
      endAt = new Date(Date.parse(startAt) + lesson.estimatedMinutes * 60_000).toISOString();
    }
    if (lessonPosition !== undefined) {
      const followingStart = context.existingSchedule
        .filter(
          (item) =>
            item.status !== 'removed' &&
            item.courseId === lesson.courseId &&
            (coursePositions?.get(item.lessonId) ?? Number.NEGATIVE_INFINITY) > lessonPosition,
        )
        .reduce(
          (earliest, item) => Math.min(earliest, Date.parse(item.startAt)),
          Number.POSITIVE_INFINITY,
        );
      if (Date.parse(endAt) > followingStart) throw new Error('plan_preview_invalid');
    }
    if (localDateAt(startAt, context.timezone) !== localDate) {
      localDate = nextLearningDate(addLocalDays(localDate, 1), learningDays, context.timezone);
      startAt = zonedInstant(localDate, context.timezone, DEFAULT_START_HOUR);
      endAt = new Date(Date.parse(startAt) + lesson.estimatedMinutes * 60_000).toISOString();
      used = usedMinutes.get(localDate) ?? 0;
    }

    const strategyExplanation =
      context.userPreferences.strategy === 'balanced'
        ? '按课程轮换并优先填充每日剩余容量'
        : context.userPreferences.strategy === 'focus'
          ? '按课程顺序专注完成'
          : '按课程优先级并用已就绪课节填充每日剩余容量';
    suggestions.push({
      courseId: lesson.courseId,
      lessonId: lesson.lessonId,
      startAt,
      endAt,
      timezoneAtCreation: context.timezone,
      explanation: `${strategyExplanation}；遵守前置依赖、学习日和每日 ${dailyTargetMinutes} 分钟目标`,
    });
    usedMinutes.set(localDate, used + lesson.estimatedMinutes);
    completeLesson(graph, lesson);
    if (used + lesson.estimatedMinutes >= dailyTargetMinutes) {
      localDate = nextLearningDate(addLocalDays(localDate, 1), learningDays, context.timezone);
    }
  }
  return suggestions;
}
