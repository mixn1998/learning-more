import { describe, expect, it } from 'vitest';

import { buildCourseChoiceModel, type HomeLessonCandidate } from './course-choice-model.js';

const lessons: readonly HomeLessonCandidate[] = [
  {
    courseId: 'course_01',
    lessonId: 'completed_01',
    title: '完成的第一课',
    progress: 'completed',
    lastActivityAt: '2026-07-11T08:00:00.000Z',
  },
  {
    courseId: 'course_01',
    lessonId: 'completed_02',
    title: '完成的第二课',
    progress: 'completed',
    lastActivityAt: '2026-07-12T09:30:00.000Z',
  },
  {
    courseId: 'course_01',
    lessonId: 'active',
    title: '正在学习的课节',
    progress: 'in_progress',
    sessionId: 'session_01',
    lastActivityAt: '2026-07-12T12:30:00.000Z',
  },
  {
    courseId: 'course_01',
    lessonId: 'recommended',
    title: '推荐课节',
    progress: 'not_started',
    recommended: true,
  },
  {
    courseId: 'course_01',
    lessonId: 'later',
    title: '后续课节',
    progress: 'not_started',
  },
  {
    courseId: 'course_02',
    lessonId: 'other-course',
    title: '其他课程课节',
    progress: 'completed',
    lastActivityAt: '2026-07-13T12:30:00.000Z',
  },
];

describe('course choice model', () => {
  it('aggregates progress and the latest real learning activity per course', () => {
    expect(buildCourseChoiceModel('course_01', lessons)).toMatchObject({
      lessonCount: 5,
      completedLessonCount: 2,
      progressPercent: 40,
      lastActivityAt: '2026-07-12T12:30:00.000Z',
      nextLesson: expect.objectContaining({ lessonId: 'active' }),
    });
  });

  it('uses the recommended unstarted lesson when no active session exists', () => {
    const withoutActive = lessons.filter((lesson) => lesson.lessonId !== 'active');

    expect(buildCourseChoiceModel('course_01', withoutActive).nextLesson?.lessonId).toBe(
      'recommended',
    );
  });

  it('reports an unstarted course without inventing recent activity', () => {
    expect(
      buildCourseChoiceModel('course_03', [
        {
          courseId: 'course_03',
          lessonId: 'new',
          title: '尚未开始',
          progress: 'not_started',
        },
      ]),
    ).toEqual({
      lessonCount: 1,
      completedLessonCount: 0,
      progressPercent: 0,
    });
  });
});
