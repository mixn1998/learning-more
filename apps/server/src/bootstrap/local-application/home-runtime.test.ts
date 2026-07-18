import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { DataRoot } from '../../persistence/data-root.js';
import { createReadRevisionTracker } from '../../persistence/read-revision.js';
import type { LocalCourseRuntime } from './course-runtime.js';
import { createHomeRouteOptions } from './home-runtime.js';
import type { LocalLearningRuntime } from './learning-runtime.js';
import type { LocalPlanningRuntime } from './planning-runtime.js';

describe('home runtime query', () => {
  it('uses bulk lesson and learning snapshots without N+1 reads', async () => {
    const dataRoot = DataRoot.create(await mkdtemp(path.join(os.tmpdir(), 'learning-more-home-')));
    const lessonIds = ['lesson_01', 'lesson_02', 'lesson_03', 'lesson_04'];
    const getLesson = vi.fn();
    const getRecord = vi.fn();
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
      dataRoot,
      readRevision: await createReadRevisionTracker(dataRoot),
      course: {
        access: {
          async *listDraftSessions() {},
          async *listCourses() {
            yield course;
          },
          async *listAllLessons() {
            for (const lessonId of [...lessonIds].reverse()) {
              yield {
                id: lessonId,
                courseId: course.id,
                title: lessonId,
                objective: `${lessonId} objective`,
                coreKnowledgePoints: [],
                estimatedMinutes: 30,
              };
            }
          },
          getOutlineVersion: async () => ({ disciplineTag: '数学', topicTags: [] }),
          getLesson,
        },
      } as unknown as LocalCourseRuntime,
      learning: {
        access: {
          getRecord,
          async *listRecords() {},
        },
      } as unknown as LocalLearningRuntime,
      planning: {
        access: { listSchedule: async () => [] },
      } as unknown as LocalPlanningRuntime,
    });

    const view = await runtime.getHome();

    expect(getLesson).not.toHaveBeenCalled();
    expect(getRecord).not.toHaveBeenCalled();
    expect(view.value.lessons.map((lesson) => lesson.lessonId)).toEqual(lessonIds);
  });
});
