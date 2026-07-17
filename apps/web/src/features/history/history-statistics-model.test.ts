import { describe, expect, it } from 'vitest';

import type {
  CalendarDay,
  HistoryEntry,
  HomeDashboardView,
  StatisticsResponse,
} from '@learning-more/contracts';

import { buildStatisticsCourses, buildStatisticsSnapshot } from './history-statistics-model.js';

const dashboard: HomeDashboardView = {
  generatedAt: '2026-07-14T00:00:00.000Z',
  draftSessions: [],
  courses: [
    {
      courseId: 'course_a',
      title: '产品设计',
      status: 'active',
      courseMode: 'standard',
      outlineVersionId: 'outline_a',
      disciplineTag: '产品与设计',
      resourceVersion: 1,
    },
    {
      courseId: 'course_b',
      title: '增长实验',
      status: 'closed',
      courseMode: 'brainstorm',
      outlineVersionId: 'outline_b',
      disciplineTag: '增长与营销',
      resourceVersion: 2,
    },
  ],
  lessons: [
    {
      courseId: 'course_a',
      lessonId: 'lesson_a1',
      title: '问题定义',
      progress: 'completed',
      recommended: false,
    },
    {
      courseId: 'course_a',
      lessonId: 'lesson_a2',
      title: '原型验证',
      progress: 'abandoned',
      recommended: false,
    },
    {
      courseId: 'course_b',
      lessonId: 'lesson_b1',
      title: '实验设计',
      progress: 'completed',
      recommended: true,
    },
  ],
  schedule: [],
};

const statistics: StatisticsResponse = {
  totalActualSeconds: 99_999,
  validSessionCount: 5,
  lessonCompletedCount: 8,
  lessonAbandonedCount: 1,
  lessonRestoredCount: 0,
  courseClosedCount: 7,
  activeDayCount: 6,
  currentStreakDays: 3,
  longestStreakDays: 9,
  definitions: {},
  projectionVersion: 1,
  freshness: 'current',
};

const days: readonly CalendarDay[] = [
  { localDate: '2026-06-14', actualSeconds: 7_200, completedLessonIds: ['lesson_a1'] },
  { localDate: '2026-06-15', actualSeconds: 1_800, completedLessonIds: ['lesson_a1'] },
  { localDate: '2026-07-14', actualSeconds: 3_600, completedLessonIds: ['lesson_b1'] },
  { localDate: '2025-12-31', actualSeconds: 900, completedLessonIds: ['lesson_b1'] },
];

function fact(
  factId: string,
  factType: string,
  occurredAt: string,
  subjectRefs: Readonly<Record<string, string>> = {},
  payload: Readonly<Record<string, unknown>> = {},
): HistoryEntry {
  return { factId, factType, occurredAt, subjectRefs, payload };
}

const entries: readonly HistoryEntry[] = [
  // 16:30 UTC is the next calendar day in the product's Asia/Shanghai timezone.
  fact(
    'complete-a',
    'LessonCompletedFact',
    '2026-06-14T16:30:00.000Z',
    { lessonId: 'lesson_a1' },
    { actualSeconds: 1_800 },
  ),
  fact('abandon-a', 'LessonAbandonedFact', '2026-06-15T08:00:00.000Z', { lessonId: 'lesson_a2' }),
  fact('prompt', 'InteractionPromptedFact', '2026-06-15T08:01:00.000Z'),
  fact('respond', 'InteractionRespondedFact', '2026-06-15T08:02:00.000Z'),
  fact(
    'complete-b',
    'LessonCompletedFact',
    '2026-07-14T04:00:00.000Z',
    { courseId: 'course_b', lessonId: 'lesson_b1' },
    { actualSeconds: 3_600 },
  ),
  fact('closed-b', 'CourseClosedFact', '2026-07-14T04:01:00.000Z', { courseId: 'course_b' }),
  fact('old-closed', 'CourseClosedFact', '2025-12-31T04:01:00.000Z', { courseId: 'course_old' }),
];

describe('history statistics projection', () => {
  it('uses inclusive 30-day local-date bounds and derives metrics from calendar days and facts', () => {
    const snapshot = buildStatisticsSnapshot({
      range: '30d',
      custom: { start: '2026-01-01', end: '2026-01-31' },
      today: '2026-07-14',
      statistics,
      days,
      entries,
      dashboard,
    });

    expect(snapshot).toMatchObject({
      hours: '1.5 小时',
      completedLessons: 2,
      closedCourses: 1,
      activeDays: 2,
      courseCount: 2,
      abandonedCourseCount: 1,
      currentStreakDays: 3,
      longestStreakDays: 9,
      interactionResponseRate: 100,
      interactionSkipped: 0,
    });
    expect(snapshot.disciplines).toEqual([
      { label: '增长与营销', percent: 86, hours: '1.0h' },
      { label: '产品与设计', percent: 43, hours: '0.5h' },
    ]);
    expect(snapshot.bars).toHaveLength(12);
    expect(snapshot.bars.filter((height) => height > 0)).toHaveLength(2);
  });

  it('uses the authoritative aggregate for all-time closed courses but range facts for a custom window', () => {
    const allTime = buildStatisticsSnapshot({
      range: 'all',
      custom: { start: '2026-07-14', end: '2026-07-14' },
      today: '2026-07-14',
      statistics,
      days,
      entries,
      dashboard,
    });
    const custom = buildStatisticsSnapshot({
      range: 'custom',
      custom: { start: '2026-07-14', end: '2026-07-14' },
      today: '2026-07-14',
      statistics,
      days,
      entries,
      dashboard,
    });

    expect(allTime.closedCourses).toBe(7);
    expect(custom).toMatchObject({
      hours: '1.0 小时',
      completedLessons: 1,
      closedCourses: 1,
      activeDays: 1,
      courseCount: 1,
    });
  });

  it('projects each dashboard course with its confirmed discipline tag', () => {
    expect(buildStatisticsCourses({ dashboard, entries })).toEqual([
      {
        courseId: 'course_a',
        title: '产品设计',
        domain: '产品与设计',
        topics: '问题定义 / 原型验证',
        status: '学习中',
        mode: '标准模式',
        disposition: '1 完成 · 1 放弃',
        duration: '30m',
        durationMinutes: 30,
        recentDate: '06-15',
        reviewAvailable: false,
      },
      {
        courseId: 'course_b',
        title: '增长实验',
        domain: '增长与营销',
        topics: '实验设计',
        status: '已关闭',
        mode: '头脑风暴',
        disposition: '1 / 1 完成',
        duration: '1h',
        durationMinutes: 60,
        recentDate: '07-14',
        reviewAvailable: true,
      },
    ]);
  });
});
