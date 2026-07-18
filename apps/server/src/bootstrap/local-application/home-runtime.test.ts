import { describe, expect, it } from 'vitest';

import type { LocalCourseRuntime } from './course-runtime.js';
import { createHomeRouteOptions } from './home-runtime.js';
import type { LocalLearningRuntime } from './learning-runtime.js';
import type { LocalPlanningRuntime } from './planning-runtime.js';

function delayed<T>(value: T, onStart: () => void, onFinish: () => void): Promise<T> {
  onStart();
  return new Promise((resolve) => {
    setTimeout(() => {
      onFinish();
      resolve(value);
    }, 10);
  });
}

describe('home runtime query', () => {
  it('loads independent lesson records concurrently while preserving outline order', async () => {
    const lessonIds = ['lesson_01', 'lesson_02', 'lesson_03', 'lesson_04'];
    let inFlight = 0;
    let maxInFlight = 0;
    const start = () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
    };
    const finish = () => {
      inFlight -= 1;
    };
    const course = {
      id: 'course_01',
      title: 'Course',
      status: 'active' as const,
      courseMode: 'standard' as const,
      outlineVersionId: 'outline_01',
      lessonIds,
      resourceVersion: 1,
    };
    const runtime = createHomeRouteOptions({
      now: () => new Date('2026-07-18T00:00:00.000Z'),
      course: {
        access: {
          async *listDraftSessions() {},
          async *listCourses() {
            yield course;
          },
          getOutlineVersion: async () => ({ disciplineTag: '数学', topicTags: [] }),
          getLesson: async (lessonId: string) =>
            delayed(
              {
                id: lessonId,
                courseId: course.id,
                title: lessonId,
                objective: `${lessonId} objective`,
                coreKnowledgePoints: [],
                estimatedMinutes: 30,
              },
              start,
              finish,
            ),
        },
      } as unknown as LocalCourseRuntime,
      learning: {
        access: { getRecord: async () => undefined },
      } as unknown as LocalLearningRuntime,
      planning: {
        access: { listSchedule: async () => [] },
      } as unknown as LocalPlanningRuntime,
    });

    const view = await runtime.getHome();

    expect(maxInFlight).toBeGreaterThan(1);
    expect(view.lessons.map((lesson) => lesson.lessonId)).toEqual(lessonIds);
  });
});
