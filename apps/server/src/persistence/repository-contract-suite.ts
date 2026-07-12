import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type {
  Course,
  CourseRepository,
} from '../modules/course-authoring/ports/course-repository.js';
import type {
  GenerationTask,
  GenerationTaskRepository,
} from '../modules/generation-runtime/ports/generation-task-repository.js';
import type {
  LessonSession,
  LessonSessionRepository,
} from '../modules/learning-session/ports/lesson-session-repository.js';
import type {
  Review,
  ReviewRepository,
} from '../modules/learning-session/ports/review-repository.js';
import type { TransactionContext } from './unit-of-work.js';

export interface RepositorySet {
  readonly courses: CourseRepository;
  readonly lessonSessions: LessonSessionRepository;
  readonly reviews: ReviewRepository;
  readonly generationTasks: GenerationTaskRepository;
}

export interface RepositoryContractFixture {
  readonly repositories: RepositorySet;
  commit(work: (tx: TransactionContext) => Promise<void>): Promise<void>;
  reopen(): Promise<RepositorySet>;
  corruptCourse(courseId: string): Promise<void>;
  cleanup(): Promise<void>;
}

const now = '2026-07-13T00:00:00.000Z';

function course(id: string, resourceVersion = 0): Course {
  return {
    id,
    title: `课程 ${id}`,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    resourceVersion,
  };
}

const lessonSession: LessonSession = {
  id: 'session_01',
  lessonId: 'lesson_01',
  status: 'active',
  createdAt: now,
  updatedAt: now,
  resourceVersion: 0,
};

const review: Review = {
  id: 'review_01',
  lessonId: 'lesson_01',
  status: 'stage',
  artifactId: 'artifact_01',
  immutable: false,
  createdAt: now,
  updatedAt: now,
  resourceVersion: 0,
};

const generationTask: GenerationTask = {
  id: 'task_01',
  taskKey: 'lesson-review:lesson_01',
  status: 'queued',
  createdAt: now,
  updatedAt: now,
  resourceVersion: 0,
};

export function runRepositoryContractSuite(
  adapterName: string,
  createFixture: () => Promise<RepositoryContractFixture>,
): void {
  describe(`${adapterName} repository contract [EQ-DATA-01]`, () => {
    let fixture: RepositoryContractFixture;

    beforeEach(async () => {
      fixture = await createFixture();
    });

    afterEach(async () => {
      await fixture.cleanup();
    });

    it('creates, reads, and stably lists Unicode course ids', async () => {
      await fixture.commit(async (tx) => {
        await fixture.repositories.courses.save(tx, course('课程_乙'), 0);
        await fixture.repositories.courses.save(tx, course('课程_甲'), 0);
      });

      await expect(fixture.repositories.courses.get('课程_甲')).resolves.toMatchObject({
        id: '课程_甲',
        resourceVersion: 1,
      });
      const listed: Course[] = [];
      for await (const item of fixture.repositories.courses.list({})) listed.push(item);
      expect(listed.map((item) => item.id)).toEqual(['课程_乙', '课程_甲'].sort());
    });

    it('reports optimistic version conflicts without overwriting current data', async () => {
      await fixture.commit((tx) => fixture.repositories.courses.save(tx, course('course_01'), 0));

      await expect(
        fixture.commit((tx) =>
          fixture.repositories.courses.save(tx, { ...course('course_01'), title: '冲突写入' }, 0),
        ),
      ).rejects.toMatchObject({ code: 'version_conflict', currentVersion: 1 });
      await expect(fixture.repositories.courses.get('course_01')).resolves.toMatchObject({
        title: '课程 course_01',
        resourceVersion: 1,
      });
    });

    it('returns undefined for missing entities in all four repositories', async () => {
      await expect(fixture.repositories.courses.get('missing')).resolves.toBeUndefined();
      await expect(fixture.repositories.lessonSessions.get('missing')).resolves.toBeUndefined();
      await expect(fixture.repositories.reviews.get('missing')).resolves.toBeUndefined();
      await expect(fixture.repositories.generationTasks.get('missing')).resolves.toBeUndefined();
    });

    it('preserves all four aggregate types when the adapter is reopened', async () => {
      await fixture.commit(async (tx) => {
        await fixture.repositories.courses.save(tx, course('course_01'), 0);
        await fixture.repositories.lessonSessions.save(tx, lessonSession, 0);
        await fixture.repositories.reviews.save(tx, review, 0);
        await fixture.repositories.generationTasks.save(tx, generationTask, 0);
      });

      const reopened = await fixture.reopen();

      await expect(reopened.courses.get('course_01')).resolves.toMatchObject({
        resourceVersion: 1,
      });
      await expect(reopened.lessonSessions.get('session_01')).resolves.toMatchObject({
        resourceVersion: 1,
      });
      await expect(reopened.reviews.get('review_01')).resolves.toMatchObject({
        resourceVersion: 1,
      });
      await expect(reopened.generationTasks.get('task_01')).resolves.toMatchObject({
        resourceVersion: 1,
      });
    });

    it('permanently rejects overwriting a final immutable Review', async () => {
      await fixture.commit((tx) =>
        fixture.repositories.reviews.save(tx, { ...review, status: 'final', immutable: true }, 0),
      );

      await expect(
        fixture.commit((tx) =>
          fixture.repositories.reviews.save(
            tx,
            { ...review, status: 'stage', artifactId: 'artifact_replacement' },
            1,
          ),
        ),
      ).rejects.toMatchObject({ code: 'immutable_resource' });
    });

    it('surfaces aggregate corruption instead of silently skipping it', async () => {
      await fixture.commit((tx) => fixture.repositories.courses.save(tx, course('course_01'), 0));
      await fixture.corruptCourse('course_01');

      await expect(fixture.repositories.courses.get('course_01')).rejects.toMatchObject({
        code: 'storage_corrupted',
      });
    });
  });
}
