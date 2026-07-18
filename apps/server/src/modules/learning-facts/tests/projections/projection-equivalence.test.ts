import { describe, expect, it } from 'vitest';

import type { LearningFact, LearningFactType } from '../../interface.js';
import { createCalendarProjection } from '../../implementation/projections/calendar.js';
import { createCourseSummaryProjection } from '../../implementation/projections/course-summary.js';
import { createHistoryProjection } from '../../implementation/projections/history.js';
import { createStatisticsProjection } from '../../implementation/projections/statistics.js';
import { createWeeklyProjection } from '../../implementation/projections/weekly.js';

function fact(input: {
  id: string;
  type: LearningFactType;
  at: string;
  refs?: Record<string, string>;
  payload?: Record<string, unknown>;
}): LearningFact {
  return {
    factId: input.id,
    factType: input.type,
    subjectRefs: input.refs ?? { courseId: 'course_01', lessonId: 'lesson_01' },
    occurredAt: input.at,
    recordedAt: new Date(Date.parse(input.at) + 1_000).toISOString(),
    sourceEventId: `event_${input.id}`,
    dataKeys: [],
    payload: input.payload ?? {},
    schemaVersion: 1,
  };
}

const goldenFacts = [
  fact({ id: 'f01', type: 'CourseCreatedFact', at: '2026-07-01T00:00:00.000Z' }),
  fact({
    id: 'f02',
    type: 'LessonStartedFact',
    at: '2026-07-01T23:50:00.000Z',
    payload: { sessionId: 'session_01' },
  }),
  fact({ id: 'f03', type: 'LessonPausedFact', at: '2026-07-02T00:10:00.000Z' }),
  fact({ id: 'f04', type: 'LessonAbandonedFact', at: '2026-07-02T00:20:00.000Z' }),
  fact({ id: 'f05', type: 'LessonRestoredFact', at: '2026-07-02T01:00:00.000Z' }),
  fact({
    id: 'f06',
    type: 'LessonCompletedFact',
    at: '2026-07-02T16:30:00.000Z',
    payload: { actualSeconds: 3_600, sessionId: 'session_01' },
  }),
  fact({ id: 'f07', type: 'ReviewFinalizedFact', at: '2026-07-02T16:31:00.000Z' }),
  fact({ id: 'f08', type: 'CourseClosedFact', at: '2026-07-02T16:32:00.000Z' }),
];

function projections() {
  return [
    createHistoryProjection(),
    createCourseSummaryProjection(),
    createStatisticsProjection('Asia/Shanghai'),
    createCalendarProjection('Asia/Shanghai'),
    createWeeklyProjection('Asia/Shanghai'),
  ];
}

describe('LearningFacts projection equivalence', () => {
  it('[EQ-HIS-03] produces byte-identical views for incremental, random batch, and full rebuild', () => {
    const outputs = [1, 3, 100].map((batchSize) => {
      const instances = projections();
      for (let offset = 0; offset < goldenFacts.length; offset += batchSize) {
        const batch = goldenFacts.slice(offset, offset + batchSize);
        for (const projection of instances) projection.apply(batch);
      }
      return instances.map((projection) => JSON.stringify(projection.view()));
    });
    expect(outputs[0]).toEqual(outputs[1]);
    expect(outputs[1]).toEqual(outputs[2]);
  });

  it('builds history, course summary, statistics, calendar, and weekly views from facts only', () => {
    const history = createHistoryProjection();
    const courses = createCourseSummaryProjection();
    const statistics = createStatisticsProjection('Asia/Shanghai');
    const calendar = createCalendarProjection('Asia/Shanghai');
    const weekly = createWeeklyProjection('Asia/Shanghai');
    for (const projection of [history, courses, statistics, calendar, weekly]) {
      projection.apply(goldenFacts);
    }
    expect(history.view()).toMatchObject({
      asOfEventId: 'event_f08',
      freshness: 'current',
      projectionVersion: 1,
    });
    expect(history.view().entries.map((entry) => entry.factId)).toEqual(
      goldenFacts.map((item) => item.factId),
    );
    expect(courses.view().courses).toEqual([
      expect.objectContaining({
        courseId: 'course_01',
        status: 'closed',
        completedLessonCount: 1,
        actualSeconds: 3_600,
        finalReviewCount: 1,
      }),
    ]);
    expect(statistics.view()).toMatchObject({
      totalActualSeconds: 3_600,
      validSessionCount: 1,
      lessonCompletedCount: 1,
      lessonAbandonedCount: 1,
      lessonRestoredCount: 1,
      courseClosedCount: 1,
      activeDayCount: 1,
      currentStreakDays: 1,
      longestStreakDays: 1,
    });
    expect(calendar.view().days).toEqual([
      {
        localDate: '2026-07-03',
        actualSeconds: 3_600,
        completedLessonIds: ['lesson_01'],
        completions: [{ lessonId: 'lesson_01', courseId: 'course_01', actualSeconds: 3_600 }],
      },
    ]);
    expect(weekly.view().weeks).toEqual([
      {
        isoWeek: '2026-W27',
        timezone: 'Asia/Shanghai',
        actualSeconds: 3_600,
        completedLessonCount: 1,
        activeDayCount: 1,
      },
    ]);
  });

  it('handles leap day, year-crossing ISO weeks, and tied occurrence times deterministically', () => {
    const edgeFacts = [
      fact({
        id: 'tie_b',
        type: 'LessonCompletedFact',
        at: '2024-02-29T15:59:59.000Z',
        refs: { lessonId: 'lesson_b' },
        payload: { actualSeconds: 60 },
      }),
      fact({
        id: 'tie_a',
        type: 'LessonCompletedFact',
        at: '2024-02-29T15:59:59.000Z',
        refs: { lessonId: 'lesson_a' },
        payload: { actualSeconds: 120 },
      }),
      fact({
        id: 'year_cross',
        type: 'LessonCompletedFact',
        at: '2024-12-31T16:30:00.000Z',
        refs: { lessonId: 'lesson_c' },
        payload: { actualSeconds: 180 },
      }),
    ];
    const history = createHistoryProjection();
    const calendar = createCalendarProjection('Asia/Shanghai');
    const weekly = createWeeklyProjection('Asia/Shanghai');
    for (const projection of [history, calendar, weekly]) projection.apply(edgeFacts);
    expect(history.view().entries.map((entry) => entry.factId)).toEqual([
      'tie_a',
      'tie_b',
      'year_cross',
    ]);
    expect(calendar.view().days.map((day) => day.localDate)).toEqual(['2024-02-29', '2025-01-01']);
    expect(weekly.view().weeks.map((week) => week.isoWeek)).toEqual(['2024-W09', '2025-W01']);
  });
});
