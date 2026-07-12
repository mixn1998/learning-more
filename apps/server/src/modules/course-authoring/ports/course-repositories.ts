import type { TransactionContext } from '../../../persistence/unit-of-work.js';
import type { ConfirmedOutlineVersion, CourseAggregate } from '../model/course.js';
import type { LessonDefinition } from '../model/lesson-definition.js';
import {
  ImmutableResourceError,
  RepositoryVersionConflictError,
} from '../../../persistence/repository-errors.js';

export interface CourseCreationRepositories {
  readonly courses: {
    get(id: string): Promise<CourseAggregate | undefined>;
    save(tx: TransactionContext, course: CourseAggregate, expectedVersion: number): Promise<void>;
  };
  readonly outlineVersions: {
    get(id: string): Promise<ConfirmedOutlineVersion | undefined>;
    save(
      tx: TransactionContext,
      outline: ConfirmedOutlineVersion,
      expectedVersion: 0,
    ): Promise<void>;
  };
  readonly lessons: {
    get(id: string): Promise<LessonDefinition | undefined>;
    save(tx: TransactionContext, lesson: LessonDefinition, expectedVersion: 0): Promise<void>;
    listByCourse(courseId: string): AsyncIterable<LessonDefinition>;
  };
}

export function createInMemoryCourseCreationRepositories(): CourseCreationRepositories {
  const courses = new Map<string, CourseAggregate>();
  const outlines = new Map<string, ConfirmedOutlineVersion>();
  const lessons = new Map<string, LessonDefinition>();
  function immutableSave<T extends { id: string; resourceVersion: number }>(
    map: Map<string, T>,
    value: T,
    expectedVersion: 0,
  ) {
    if (expectedVersion !== 0) throw new RepositoryVersionConflictError(0);
    if (map.has(value.id)) throw new ImmutableResourceError();
    map.set(value.id, structuredClone({ ...value, resourceVersion: 1 }));
  }
  return {
    courses: {
      get: async (id) => structuredClone(courses.get(id)),
      async save(_tx, value, expected) {
        const currentVersion = courses.get(value.id)?.resourceVersion ?? 0;
        if (currentVersion !== expected || value.resourceVersion !== expected) {
          throw new RepositoryVersionConflictError(currentVersion);
        }
        courses.set(value.id, structuredClone({ ...value, resourceVersion: expected + 1 }));
      },
    },
    outlineVersions: {
      get: async (id) => structuredClone(outlines.get(id)),
      save: async (_tx, value, expected) => immutableSave(outlines, value, expected),
    },
    lessons: {
      get: async (id) => structuredClone(lessons.get(id)),
      save: async (_tx, value, expected) => immutableSave(lessons, value, expected),
      async *listByCourse(courseId) {
        for (const lesson of lessons.values()) {
          if (lesson.courseId === courseId) yield structuredClone(lesson);
        }
      },
    },
  };
}
