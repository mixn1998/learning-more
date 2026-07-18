import type {
  CalendarDay,
  HistoryEntry,
  HomeDashboardView,
  StatisticsResponse,
} from '@learning-more/contracts';

import { COURSE_MODE_REGISTRY } from '../../course-mode-registry.js';
import { toBroadDisciplineLabel } from '../../discipline-label.js';
import type {
  HistoryStatisticsCourse,
  HistoryStatisticsRange,
  HistoryStatisticsSnapshot,
} from './history-statistics-workspace.js';

const DAY_MS = 86_400_000;

function dateFromLocal(value: string): Date {
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day));
}

function localDate(value: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value));
  const get = (type: string) => parts.find((part) => part.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function bounds(
  range: HistoryStatisticsRange,
  custom: Readonly<{ start: string; end: string }>,
  today: string,
): Readonly<{ start?: string; end: string }> {
  if (range === 'all') return { end: today };
  if (range === 'custom') return custom;
  if (range === 'year') return { start: `${today.slice(0, 4)}-01-01`, end: today };
  return { start: isoDate(new Date(dateFromLocal(today).getTime() - 29 * DAY_MS)), end: today };
}

function inBounds(value: string, range: Readonly<{ start?: string; end: string }>): boolean {
  return (range.start === undefined || value >= range.start) && value <= range.end;
}

function hoursLabel(seconds: number): string {
  return `${(seconds / 3_600).toFixed(1)} 小时`;
}

function compactHours(seconds: number): string {
  return `${(seconds / 3_600).toFixed(1)}h`;
}

function durationLabel(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours === 0) return `${remainder}m`;
  return remainder === 0 ? `${hours}h` : `${hours}h ${remainder}m`;
}

function secondsOf(entry: HistoryEntry): number {
  return typeof entry.payload.actualSeconds === 'number' ? entry.payload.actualSeconds : 0;
}

function courseIdForEntry(
  entry: HistoryEntry,
  lessonCourse: ReadonlyMap<string, string>,
): string | undefined {
  return (
    entry.subjectRefs.courseId ??
    (entry.subjectRefs.lessonId === undefined
      ? undefined
      : lessonCourse.get(entry.subjectRefs.lessonId))
  );
}

export function buildStatisticsSnapshot(input: {
  readonly range: HistoryStatisticsRange;
  readonly custom: Readonly<{ start: string; end: string }>;
  readonly today: string;
  readonly statistics: StatisticsResponse;
  readonly days: readonly CalendarDay[];
  readonly entries: readonly HistoryEntry[];
  readonly dashboard?: HomeDashboardView | undefined;
}): HistoryStatisticsSnapshot {
  const selectedBounds = bounds(input.range, input.custom, input.today);
  const selectedDays = input.days.filter((day) => inBounds(day.localDate, selectedBounds));
  const selectedEntries = input.entries.filter((entry) =>
    inBounds(localDate(entry.occurredAt), selectedBounds),
  );
  const lessonCourse = new Map(
    input.dashboard?.lessons.map((lesson) => [lesson.lessonId, lesson.courseId]) ?? [],
  );
  const courseDiscipline = new Map(
    input.dashboard?.courses.map((course) => [
      course.courseId,
      toBroadDisciplineLabel(course.disciplineTag) ?? '未分类领域',
    ]) ?? [],
  );
  const completedCourseIds = new Set<string>();
  for (const day of selectedDays) {
    for (const lessonId of day.completedLessonIds) {
      const courseId = lessonCourse.get(lessonId);
      if (courseId !== undefined) completedCourseIds.add(courseId);
    }
  }
  for (const entry of selectedEntries) {
    if (entry.factType !== 'LessonCompletedFact') continue;
    const courseId = courseIdForEntry(entry, lessonCourse);
    if (courseId !== undefined) completedCourseIds.add(courseId);
  }
  const closedCourseIds = new Set(
    selectedEntries
      .filter((entry) => entry.factType === 'CourseClosedFact')
      .map((entry) => entry.subjectRefs.courseId)
      .filter((value): value is string => value !== undefined),
  );
  const abandonedCourseIds = new Set(
    selectedEntries
      .filter((entry) => entry.factType === 'LessonAbandonedFact')
      .map((entry) => courseIdForEntry(entry, lessonCourse))
      .filter((value): value is string => value !== undefined),
  );
  const aggregateFallback = selectedDays.length === 0 && input.statistics.lessonCompletedCount > 0;
  const totalSeconds = aggregateFallback
    ? input.statistics.totalActualSeconds
    : selectedDays.reduce((sum, day) => sum + day.actualSeconds, 0);
  const completionCount = aggregateFallback
    ? input.statistics.lessonCompletedCount
    : selectedDays.reduce((sum, day) => sum + day.completedLessonIds.length, 0);

  const end = dateFromLocal(selectedBounds.end);
  const start = new Date(end.getTime() - 83 * DAY_MS);
  const rawBars = Array.from({ length: 12 }, () => 0);
  for (const day of selectedDays) {
    const index = Math.floor(
      (dateFromLocal(day.localDate).getTime() - start.getTime()) / (7 * DAY_MS),
    );
    if (index >= 0 && index < rawBars.length) rawBars[index]! += day.actualSeconds;
  }
  const maxBar = Math.max(...rawBars, 1);
  const bars = rawBars.map((value) =>
    value === 0 ? 0 : Math.max(8, Math.round((value / maxBar) * 94)),
  );

  const secondsByDiscipline = new Map<string, number>();
  for (const entry of selectedEntries) {
    if (entry.factType !== 'LessonCompletedFact') continue;
    const courseId = courseIdForEntry(entry, lessonCourse);
    const label =
      (courseId === undefined ? undefined : courseDiscipline.get(courseId)) ?? '未分类领域';
    secondsByDiscipline.set(label, (secondsByDiscipline.get(label) ?? 0) + secondsOf(entry));
  }
  const ranked = [...secondsByDiscipline.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 4);
  const topSeconds = Math.max(ranked[0]?.[1] ?? 0, 1);
  const disciplines =
    ranked.length === 0
      ? [{ label: '暂无完成记录', percent: 0, hours: '0.0h' }]
      : ranked.map(([label, seconds]) => ({
          label,
          percent: Math.round((seconds / topSeconds) * 86),
          hours: compactHours(seconds),
        }));
  const responded = selectedEntries.filter(
    (entry) => entry.factType === 'InteractionRespondedFact',
  ).length;
  const skipped = selectedEntries.filter(
    (entry) => entry.factType === 'InteractionSkippedFact',
  ).length;
  const prompted = selectedEntries.filter(
    (entry) => entry.factType === 'InteractionPromptedFact',
  ).length;

  return {
    hours: hoursLabel(totalSeconds),
    completedLessons: completionCount,
    closedCourses:
      input.range === 'all' ? input.statistics.courseClosedCount : closedCourseIds.size,
    activeDays: aggregateFallback
      ? input.statistics.activeDayCount
      : selectedDays.filter((day) => day.actualSeconds > 0 || day.completedLessonIds.length > 0)
          .length,
    courseCount: completedCourseIds.size,
    abandonedCourseCount: abandonedCourseIds.size,
    currentStreakDays: input.statistics.currentStreakDays,
    longestStreakDays: input.statistics.longestStreakDays,
    bars,
    disciplines,
    interactionResponseRate: prompted === 0 ? 0 : Math.round((responded / prompted) * 100),
    interactionSkipped: skipped,
  };
}

export function buildStatisticsCourses(input: {
  readonly dashboard?: HomeDashboardView | undefined;
  readonly entries: readonly HistoryEntry[];
}): readonly HistoryStatisticsCourse[] {
  const dashboard = input.dashboard;
  if (dashboard === undefined) return [];
  const modeLabel = new Map(COURSE_MODE_REGISTRY.map((mode) => [mode.id, mode.label]));
  return dashboard.courses.map((course) => {
    const lessons = dashboard.lessons.filter((lesson) => lesson.courseId === course.courseId);
    const lessonIds = new Set(lessons.map((lesson) => lesson.lessonId));
    const completionFacts = input.entries.filter(
      (entry) =>
        entry.factType === 'LessonCompletedFact' &&
        (entry.subjectRefs.courseId === course.courseId ||
          (entry.subjectRefs.lessonId !== undefined && lessonIds.has(entry.subjectRefs.lessonId))),
    );
    const seconds = completionFacts.reduce((sum, entry) => sum + secondsOf(entry), 0);
    const latest = completionFacts
      .map((entry) => localDate(entry.occurredAt))
      .sort((left, right) => right.localeCompare(left))[0];
    const completed = lessons.filter((lesson) => lesson.progress === 'completed').length;
    const abandoned = lessons.filter((lesson) => lesson.progress === 'abandoned').length;
    return {
      courseId: course.courseId,
      title: course.title,
      domain: toBroadDisciplineLabel(course.disciplineTag) ?? '未分类领域',
      topics:
        lessons
          .slice(0, 3)
          .map((lesson) => lesson.title)
          .join(' / ') || '暂无课节目录',
      status: course.status === 'closed' ? '已关闭' : '学习中',
      mode: modeLabel.get(course.courseMode) ?? course.courseMode,
      disposition:
        abandoned === 0
          ? `${completed} / ${lessons.length} 完成`
          : `${completed} 完成 · ${abandoned} 放弃`,
      duration: durationLabel(seconds),
      durationMinutes: Math.round(seconds / 60),
      recentDate: latest === undefined ? '—' : latest.slice(5),
      reviewAvailable: course.status === 'closed',
    };
  });
}
