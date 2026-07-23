import { describe, expect, it } from 'vitest';

import {
  cancelActiveSchedulesForAbandonment,
  derivePlanningScheduleStatus,
  selectPlanningCandidates,
} from '../implementation/scheduling-policy.js';
import type { ScheduleItem } from '../model/schedule-item.js';

const scheduled: ScheduleItem = {
  id: 'schedule_01',
  courseId: 'course_01',
  lessonId: 'lesson_01',
  startAt: '2026-07-14T01:00:00.000Z',
  endAt: '2026-07-14T02:00:00.000Z',
  timezoneAtCreation: 'Asia/Shanghai',
  source: 'plan-flow',
  status: 'scheduled',
  createdAt: '2026-07-13T00:00:00.000Z',
  updatedAt: '2026-07-13T00:00:00.000Z',
  processedCommandIds: [],
  resourceVersion: 1,
};

describe('scheduling policy', () => {
  it('[EQ-SCH-01] derives only three planning states and excludes completed or abandoned lessons', () => {
    const today = '2026-07-14';

    expect(derivePlanningScheduleStatus(undefined, 'not_started', today)).toBe('unplanned');
    expect(
      derivePlanningScheduleStatus(
        { ...scheduled, startAt: '2026-07-15T01:00:00.000Z' },
        'not_started',
        today,
      ),
    ).toBe('planned');
    expect(derivePlanningScheduleStatus(scheduled, 'in_progress', today)).toBe('planned');
    expect(
      derivePlanningScheduleStatus(
        { ...scheduled, startAt: '2026-07-13T01:00:00.000Z' },
        'not_started',
        today,
      ),
    ).toBe('overdue');
    expect(
      derivePlanningScheduleStatus({ ...scheduled, status: 'removed' }, 'in_progress', today),
    ).toBe('unplanned');
    expect(
      selectPlanningCandidates([
        { id: 'new', progress: 'not_started' as const },
        { id: 'active', progress: 'in_progress' as const },
        { id: 'abandoned', progress: 'abandoned' as const },
        { id: 'done', progress: 'completed' as const },
      ]).map((lesson) => lesson.id),
    ).toEqual(['new', 'active']);
    expect(() => derivePlanningScheduleStatus(undefined, 'abandoned', today)).toThrow(
      'lesson_not_plannable',
    );
  });

  it('[EQ-SCH-06] cancels active schedules on abandonment and never reinstates them on restore', () => {
    const result = cancelActiveSchedulesForAbandonment(
      [scheduled, { ...scheduled, id: 'schedule_other', lessonId: 'lesson_other' }],
      'lesson_01',
      '2026-07-14T03:00:00.000Z',
    );

    expect(result.items[0]).toMatchObject({ status: 'removed', cancelReason: 'lesson_abandoned' });
    expect(result.history).toEqual([
      expect.objectContaining({ scheduleItemId: 'schedule_01', type: 'ScheduleCancelled' }),
    ]);
    expect(result.restore()).toEqual(result.items);
  });
});
