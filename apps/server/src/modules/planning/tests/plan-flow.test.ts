import { describe, expect, it } from 'vitest';

import { applyPlanFlowAction, reflowCourseLessons } from '../implementation/plan-flow-policy.js';

describe('plan-flow policy', () => {
  it('[EQ-SCH-03] preserves a manually locked plan-flow assignment during reflow', () => {
    const result = reflowCourseLessons({
      startLocalDate: '2026-07-14',
      dailyCapacityMinutes: 60,
      lessons: [
        { courseId: 'course_01', lessonId: 'lesson_01', order: 1, estimatedMinutes: 30 },
        { courseId: 'course_01', lessonId: 'lesson_02', order: 2, estimatedMinutes: 30 },
        {
          courseId: 'course_01',
          lessonId: 'lesson_abandoned',
          order: 3,
          estimatedMinutes: 30,
          lifecycle: 'abandoned',
        },
      ],
      existing: [{ lessonId: 'lesson_01', plannedLocalDate: '2026-07-20', locked: true }],
    });

    expect(result.assignments.find((item) => item.lessonId === 'lesson_01')).toMatchObject({
      plannedLocalDate: '2026-07-20',
      locked: true,
    });
    expect(result.assignments.map((item) => item.lessonId)).not.toContain('lesson_abandoned');
  });

  it('[EQ-PF-03] preserves lesson order within each course', () => {
    const result = reflowCourseLessons({
      startLocalDate: '2026-07-14',
      dailyCapacityMinutes: 45,
      lessons: [
        { courseId: 'course_01', lessonId: 'lesson_03', order: 3, estimatedMinutes: 20 },
        { courseId: 'course_01', lessonId: 'lesson_01', order: 1, estimatedMinutes: 20 },
        { courseId: 'course_01', lessonId: 'lesson_02', order: 2, estimatedMinutes: 20 },
      ],
      existing: [],
    });

    expect(result.assignments.map((item) => item.lessonId)).toEqual([
      'lesson_01',
      'lesson_02',
      'lesson_03',
    ]);
  });

  it('[EQ-PF-04] never splits a lesson and marks a single lesson over target', () => {
    const result = reflowCourseLessons({
      startLocalDate: '2026-07-14',
      dailyCapacityMinutes: 60,
      lessons: [{ courseId: 'course_01', lessonId: 'lesson_long', order: 1, estimatedMinutes: 90 }],
      existing: [],
    });

    expect(result.assignments).toEqual([
      expect.objectContaining({ lessonId: 'lesson_long', estimatedMinutes: 90, overTarget: true }),
    ]);
  });

  it('[EQ-PF-05] enforces pause, resume, reflow, and delete lifecycle rules', () => {
    expect(applyPlanFlowAction('active', 'pause')).toBe('paused');
    expect(applyPlanFlowAction('paused', 'resume')).toBe('active');
    expect(applyPlanFlowAction('active', 'reflow')).toBe('active');
    expect(applyPlanFlowAction('paused', 'delete')).toBe('deleted');
    expect(() => applyPlanFlowAction('deleted', 'resume')).toThrowError('plan_flow_deleted');
  });
});
