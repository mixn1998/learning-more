import { describe, expect, it } from 'vitest';

import type { PlanPreviewContext } from '../implementation/plan-flow-service.js';
import { buildPlanSuggestions } from '../implementation/plan-flow-scheduler.js';

function context(overrides: Partial<PlanPreviewContext> = {}): PlanPreviewContext {
  return {
    courses: [{ courseId: 'course_01', title: 'Probability' }],
    lessons: [
      {
        lessonId: 'lesson_02',
        courseId: 'course_01',
        title: 'Applications',
        objective: 'Apply foundations',
        prerequisiteLessonIds: ['lesson_01'],
        estimatedMinutes: 45,
        progress: 'not_started',
      },
      {
        lessonId: 'lesson_01',
        courseId: 'course_01',
        title: 'Foundations',
        objective: 'Build foundations',
        prerequisiteLessonIds: [],
        estimatedMinutes: 45,
        progress: 'not_started',
      },
    ],
    timezone: 'Asia/Shanghai',
    availability: {
      startLocalDate: '2026-07-14',
      dailyTargetMinutes: 60,
      learningDays: ['周二', '周三'],
    },
    userPreferences: {
      preserveExistingDates: true,
      rescheduleOverdue: false,
      strategy: 'balanced',
    },
    existingSchedule: [],
    fixedCommitments: [],
    ...overrides,
  };
}

describe('deterministic plan-flow scheduler', () => {
  it('produces distinct course ordering for balanced, focus, and priority strategies', () => {
    const courses = [
      { courseId: 'course_a', title: 'Course A' },
      { courseId: 'course_b', title: 'Course B' },
      { courseId: 'course_c', title: 'Course C' },
    ];
    const lessons = [
      ['a_1', 'course_a', 40],
      ['a_2', 'course_a', 40],
      ['b_1', 'course_b', 50],
      ['b_2', 'course_b', 50],
      ['c_1', 'course_c', 30],
      ['c_2', 'course_c', 30],
    ].map(([lessonId, courseId, estimatedMinutes]) => ({
      lessonId: String(lessonId),
      courseId: String(courseId),
      title: String(lessonId),
      objective: String(lessonId),
      prerequisiteLessonIds: [],
      estimatedMinutes: Number(estimatedMinutes),
      progress: 'not_started' as const,
    }));
    const lessonRefs = lessons.map((lesson) => lesson.lessonId);
    const input = context({
      courses,
      lessons,
      availability: {
        startLocalDate: '2026-07-14',
        dailyTargetMinutes: 90,
        learningDays: ['周二', '周三', '周四', '周五'],
      },
    });
    const orderFor = (strategy: 'balanced' | 'focus' | 'priority') =>
      buildPlanSuggestions(
        {
          ...input,
          userPreferences: { ...input.userPreferences, strategy },
        },
        lessonRefs,
      ).map((item) => item.lessonId);

    expect(orderFor('balanced')).toEqual(['a_1', 'b_1', 'c_1', 'a_2', 'b_2', 'c_2']);
    expect(orderFor('focus')).toEqual(['a_1', 'a_2', 'b_1', 'b_2', 'c_1', 'c_2']);
    expect(orderFor('priority')).toEqual(['a_1', 'a_2', 'b_1', 'c_1', 'b_2', 'c_2']);
  });

  it('uses a lower-priority ready lesson to fill the current daily target', () => {
    const input = context({
      courses: [
        { courseId: 'course_a', title: 'Course A' },
        { courseId: 'course_b', title: 'Course B' },
      ],
      lessons: [
        {
          lessonId: 'a_1',
          courseId: 'course_a',
          title: 'A1',
          objective: 'A1',
          prerequisiteLessonIds: [],
          estimatedMinutes: 60,
          progress: 'not_started',
        },
        {
          lessonId: 'a_2',
          courseId: 'course_a',
          title: 'A2',
          objective: 'A2',
          prerequisiteLessonIds: [],
          estimatedMinutes: 60,
          progress: 'not_started',
        },
        {
          lessonId: 'b_1',
          courseId: 'course_b',
          title: 'B1',
          objective: 'B1',
          prerequisiteLessonIds: [],
          estimatedMinutes: 30,
          progress: 'not_started',
        },
      ],
      availability: {
        startLocalDate: '2026-07-14',
        dailyTargetMinutes: 90,
        learningDays: ['周二', '周三'],
      },
      userPreferences: {
        preserveExistingDates: true,
        rescheduleOverdue: false,
        strategy: 'priority',
      },
    });

    const result = buildPlanSuggestions(input, ['a_1', 'a_2', 'b_1']);

    expect(result.map((item) => item.lessonId)).toEqual(['a_1', 'b_1', 'a_2']);
    expect(result.slice(0, 2).map((item) => item.startAt.slice(0, 10))).toEqual([
      '2026-07-14',
      '2026-07-14',
    ]);
  });

  it('orders prerequisites first and places atomic lessons on selected learning days', () => {
    const result = buildPlanSuggestions(context(), ['lesson_02', 'lesson_01']);

    expect(result.map((item) => item.lessonId)).toEqual(['lesson_01', 'lesson_02']);
    expect(result.map((item) => [item.startAt, item.endAt])).toEqual([
      ['2026-07-14T11:00:00.000Z', '2026-07-14T11:45:00.000Z'],
      ['2026-07-15T11:00:00.000Z', '2026-07-15T11:45:00.000Z'],
    ]);
  });

  it('uses the formal outline order even when lessons have no prerequisite edges', () => {
    const input = context({
      courses: [
        {
          courseId: 'course_01',
          title: 'Probability',
          lessonIds: ['lesson_01', 'lesson_02', 'lesson_03'],
        },
      ],
      lessons: [
        ...context().lessons.map((lesson) => ({ ...lesson, prerequisiteLessonIds: [] })),
        {
          lessonId: 'lesson_03',
          courseId: 'course_01',
          title: 'Advanced applications',
          objective: 'Apply the sequence',
          prerequisiteLessonIds: [],
          estimatedMinutes: 45,
          progress: 'not_started',
        },
      ],
    });

    const result = buildPlanSuggestions(input, ['lesson_03', 'lesson_01', 'lesson_02']);

    expect(result.map((item) => item.lessonId)).toEqual(['lesson_01', 'lesson_02', 'lesson_03']);
  });

  it('keeps a lesson whole when it exceeds the daily target', () => {
    const result = buildPlanSuggestions(
      context({
        lessons: [
          {
            lessonId: 'lesson_long',
            courseId: 'course_01',
            title: 'Long lesson',
            objective: 'Stay atomic',
            prerequisiteLessonIds: [],
            estimatedMinutes: 90,
            progress: 'not_started',
          },
        ],
      }),
      ['lesson_long'],
    );

    expect(result[0]).toMatchObject({
      startAt: '2026-07-14T11:00:00.000Z',
      endAt: '2026-07-14T12:30:00.000Z',
    });
  });

  it('moves a lesson after an existing collision without calling an AI', () => {
    const existing = {
      courseId: 'other_course',
      lessonId: 'other_lesson',
      startAt: '2026-07-14T11:00:00.000Z',
      endAt: '2026-07-14T12:00:00.000Z',
      timezoneAtCreation: 'Asia/Shanghai',
      status: 'scheduled',
    };
    const result = buildPlanSuggestions(
      context({
        lessons: [context().lessons[1]!],
        existingSchedule: [existing],
        fixedCommitments: [existing],
      }),
      ['lesson_01'],
    );

    expect(result[0]).toMatchObject({
      startAt: '2026-07-14T12:00:00.000Z',
      endAt: '2026-07-14T12:45:00.000Z',
    });
  });

  it('returns identical output for identical structured input', () => {
    const input = context();
    expect(buildPlanSuggestions(input, ['lesson_02', 'lesson_01'])).toEqual(
      buildPlanSuggestions(input, ['lesson_02', 'lesson_01']),
    );
  });

  it('rejects a dependency cycle', () => {
    const input = context({
      lessons: context().lessons.map((lesson) =>
        lesson.lessonId === 'lesson_01'
          ? { ...lesson, prerequisiteLessonIds: ['lesson_02'] }
          : lesson,
      ),
    });

    expect(() => buildPlanSuggestions(input, ['lesson_01', 'lesson_02'])).toThrowError(
      'plan_preview_invalid',
    );
  });

  it('rejects an unknown learning-day token immediately', () => {
    const input = context({
      availability: {
        ...context().availability,
        learningDays: ['Wednesday'],
      },
    });

    expect(() => buildPlanSuggestions(input, ['lesson_01'])).toThrowError('plan_preview_invalid');
  });
});
