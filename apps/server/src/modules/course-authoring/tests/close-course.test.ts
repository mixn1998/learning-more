import { describe, expect, it, vi } from 'vitest';

import { createInMemoryCourseCreationRepositories } from '../ports/course-repositories.js';
import { closeCourse } from '../implementation/close-course.js';
import {
  createCourseReviewWorkflow,
  createInMemoryCourseReviewRepository,
} from '../../review-closure/implementation/course-review.js';

const tx = {
  stageJson: async () => undefined,
  stageText: async () => undefined,
  deleteOnCommit: async () => undefined,
};
const unitOfWork = {
  async execute<T>(_request: unknown, work: (context: typeof tx) => Promise<T>) {
    return work(tx);
  },
};

async function fixture(
  states: Record<string, 'not_started' | 'in_progress' | 'abandoned' | 'completed'>,
) {
  const repositories = createInMemoryCourseCreationRepositories();
  await repositories.courses.save(
    tx,
    {
      id: 'course_01',
      title: 'Probability',
      courseMode: 'standard',
      outlineVersionId: 'outline_01',
      lessonIds: ['lesson_01', 'lesson_02'],
      recommendedLessonId: 'lesson_01',
      status: 'active',
      createdAt: '2026-07-13T00:00:00.000Z',
      resourceVersion: 0,
    },
    0,
  );
  const inputManifest = {
    outlineVersionId: 'outline_01',
    completedFinalReviewRefs: Object.entries(states)
      .filter(([, state]) => state === 'completed')
      .map(([id]) => `final:${id}`),
    abandonedStageReviewRefs: Object.entries(states)
      .filter(([, state]) => state === 'abandoned')
      .map(([id]) => `stage:${id}`),
    abandonedWithoutReviewLessonIds: [] as string[],
  };
  return { repositories, inputManifest, getState: async (lessonId: string) => states[lessonId]! };
}

describe('course closure', () => {
  it('[EQ-COURSE-02] returns concrete blockers and permanently locks a closed course', async () => {
    const { repositories, inputManifest, getState } = await fixture({
      lesson_01: 'not_started',
      lesson_02: 'in_progress',
    });
    await expect(
      closeCourse(
        {
          courseId: 'course_01',
          expectedVersion: 1,
          confirmAbandoned: false,
          idempotencyKey: 'c1',
        },
        {
          repositories,
          unitOfWork,
          getLessonState: getState,
          inputManifest,
          now: () => new Date(),
          nextEventId: () => 'event_01',
        },
      ),
    ).rejects.toMatchObject({
      code: 'course_not_closable',
      blockers: [
        { lessonId: 'lesson_01', state: 'not_started' },
        { lessonId: 'lesson_02', state: 'in_progress' },
      ],
    });
  });

  it('[EQ-COURSE-03] requires explicit abandoned confirmation but auto-closes an all-completed course', async () => {
    const abandoned = await fixture({ lesson_01: 'completed', lesson_02: 'abandoned' });
    await expect(
      closeCourse(
        {
          courseId: 'course_01',
          expectedVersion: 1,
          confirmAbandoned: false,
          idempotencyKey: 'c1',
        },
        {
          repositories: abandoned.repositories,
          unitOfWork,
          getLessonState: abandoned.getState,
          inputManifest: abandoned.inputManifest,
          now: () => new Date(),
          nextEventId: () => 'e1',
        },
      ),
    ).rejects.toMatchObject({ code: 'abandoned_confirmation_required' });
    const confirmed = await closeCourse(
      { courseId: 'course_01', expectedVersion: 1, confirmAbandoned: true, idempotencyKey: 'c2' },
      {
        repositories: abandoned.repositories,
        unitOfWork,
        getLessonState: abandoned.getState,
        inputManifest: abandoned.inputManifest,
        now: () => new Date('2026-07-13T01:00:00.000Z'),
        nextEventId: () => 'e2',
      },
    );
    expect(confirmed).toMatchObject({
      courseId: 'course_01',
      repeated: false,
      abandonedLessonIds: ['lesson_02'],
    });

    const completed = await fixture({ lesson_01: 'completed', lesson_02: 'completed' });
    const automatic = await closeCourse(
      { courseId: 'course_01', expectedVersion: 1, confirmAbandoned: false, idempotencyKey: 'c3' },
      {
        repositories: completed.repositories,
        unitOfWork,
        getLessonState: completed.getState,
        inputManifest: completed.inputManifest,
        now: () => new Date(),
        nextEventId: () => 'e3',
      },
    );
    expect(automatic.abandonedLessonIds).toEqual([]);
    await expect(
      closeCourse(
        {
          courseId: 'course_01',
          expectedVersion: 2,
          confirmAbandoned: false,
          idempotencyKey: 'c4',
        },
        {
          repositories: completed.repositories,
          unitOfWork,
          getLessonState: completed.getState,
          inputManifest: completed.inputManifest,
          now: () => new Date(),
          nextEventId: () => 'e4',
        },
      ),
    ).resolves.toMatchObject({ repeated: true });
  });

  it('[EQ-COURSE-04] [EQ-COURSE-05] keeps the course closed when course Review fails and freezes the retry input', async () => {
    const closed = await fixture({ lesson_01: 'completed', lesson_02: 'completed' });
    const closure = await closeCourse(
      {
        courseId: 'course_01',
        expectedVersion: 1,
        confirmAbandoned: false,
        idempotencyKey: 'close',
      },
      {
        repositories: closed.repositories,
        unitOfWork,
        getLessonState: closed.getState,
        inputManifest: closed.inputManifest,
        now: () => new Date(),
        nextEventId: () => 'event_close',
      },
    );
    const repository = createInMemoryCourseReviewRepository();
    const submit = vi.fn().mockResolvedValue({ taskId: 'task_course_review' });
    const enqueued: string[] = [];
    const workflow = createCourseReviewWorkflow({
      repository,
      unitOfWork,
      reviewTask: { submit },
      now: () => new Date(),
      outbox: {
        enqueue: async (_tx, events) => {
          enqueued.push(...events.map((event) => event.type));
        },
        dispatchPending: async () => 0,
      },
      nextEventId: () => 'event_review',
    });
    await workflow.request('course_01', closure.inputManifest, 'request_01');
    await workflow.fail('course_01', 'ai_unavailable', 'draft_course');
    await expect(closed.repositories.courses.get('course_01')).resolves.toMatchObject({
      status: 'closed',
    });
    await workflow.retry('course_01', 'retry_01');
    expect(submit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        courseId: 'course_01',
        inputManifest: closure.inputManifest,
        commandId: 'retry_01',
      }),
    );
    await expect(repository.get('course_01')).resolves.toMatchObject({
      inputManifest: closure.inputManifest,
      state: 'generating-review',
    });
    await workflow.markReady('course_01', 'artifact:course-review', 'f'.repeat(64));
    await workflow.finalize('course_01', 'finalize_01');
    expect(enqueued).toEqual(['CourseReviewFinalized']);
    await expect(workflow.finalize('course_01', 'finalize_02')).rejects.toMatchObject({
      code: 'immutable_resource',
    });
  });
});
