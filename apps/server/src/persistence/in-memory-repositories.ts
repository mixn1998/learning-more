import { z } from 'zod';

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
import { StorageDocumentError } from './json-codec.js';
import {
  ImmutableResourceError,
  type LocalFileRepositories,
  RepositoryVersionConflictError,
} from './local-file-repositories.js';

const CourseSchema: z.ZodType<Course> = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(['active', 'closed']),
  createdAt: z.string(),
  updatedAt: z.string(),
  resourceVersion: z.number().int().nonnegative(),
});
const LessonSessionSchema: z.ZodType<LessonSession> = z.object({
  id: z.string(),
  lessonId: z.string(),
  status: z.enum(['active', 'paused', 'abandoned', 'completed']),
  createdAt: z.string(),
  updatedAt: z.string(),
  resourceVersion: z.number().int().nonnegative(),
});
const ReviewSchema: z.ZodType<Review> = z.object({
  id: z.string(),
  lessonId: z.string(),
  status: z.enum(['stage', 'final']),
  artifactId: z.string(),
  immutable: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  resourceVersion: z.number().int().nonnegative(),
});
const GenerationTaskSchema: z.ZodType<GenerationTask> = z.object({
  id: z.string(),
  taskKey: z.string(),
  status: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled', 'timeout']),
  createdAt: z.string(),
  updatedAt: z.string(),
  resourceVersion: z.number().int().nonnegative(),
});

export interface InMemoryRepositoryBacking {
  readonly courses: Map<string, unknown>;
  readonly lessonSessions: Map<string, unknown>;
  readonly reviews: Map<string, unknown>;
  readonly generationTasks: Map<string, unknown>;
}

export function createInMemoryRepositoryBacking(): InMemoryRepositoryBacking {
  return {
    courses: new Map(),
    lessonSessions: new Map(),
    reviews: new Map(),
    generationTasks: new Map(),
  };
}

function readMemory<TEntity>(
  map: Map<string, unknown>,
  id: string,
  schema: z.ZodType<TEntity>,
): TEntity | undefined {
  const value = map.get(id);
  if (value === undefined) return undefined;
  try {
    return structuredClone(schema.parse(value));
  } catch (error) {
    throw new StorageDocumentError('storage_corrupted', error);
  }
}

function saveMemory<TEntity extends { id: string; resourceVersion: number }>(
  map: Map<string, unknown>,
  entity: TEntity,
  expectedVersion: number,
): void {
  const current = map.get(entity.id) as { resourceVersion?: unknown } | undefined;
  const currentVersion = typeof current?.resourceVersion === 'number' ? current.resourceVersion : 0;
  if (currentVersion !== expectedVersion || entity.resourceVersion !== expectedVersion) {
    throw new RepositoryVersionConflictError(currentVersion);
  }
  map.set(entity.id, structuredClone({ ...entity, resourceVersion: expectedVersion + 1 }));
}

async function* listMemory<TEntity>(
  map: Map<string, unknown>,
  schema: z.ZodType<TEntity>,
  limit?: number,
): AsyncIterable<TEntity> {
  let count = 0;
  for (const id of [...map.keys()].sort()) {
    if (limit !== undefined && count >= limit) return;
    const value = readMemory(map, id, schema);
    if (value !== undefined) {
      count += 1;
      yield value;
    }
  }
}

export function createInMemoryRepositories(
  backing = createInMemoryRepositoryBacking(),
): LocalFileRepositories {
  const courses: CourseRepository = {
    get: async (id) => readMemory(backing.courses, id, CourseSchema),
    save: async (_tx, entity, expectedVersion) =>
      saveMemory(backing.courses, entity, expectedVersion),
    list: (query) => listMemory(backing.courses, CourseSchema, query.limit),
  };
  const lessonSessions: LessonSessionRepository = {
    get: async (id) => readMemory(backing.lessonSessions, id, LessonSessionSchema),
    save: async (_tx, entity, expectedVersion) =>
      saveMemory(backing.lessonSessions, entity, expectedVersion),
    list: () => listMemory(backing.lessonSessions, LessonSessionSchema),
  };
  const reviews: ReviewRepository = {
    get: async (id) => readMemory(backing.reviews, id, ReviewSchema),
    async save(_tx, entity, expectedVersion) {
      const current = readMemory(backing.reviews, entity.id, ReviewSchema);
      if (current?.immutable === true || current?.status === 'final')
        throw new ImmutableResourceError();
      saveMemory(backing.reviews, entity, expectedVersion);
    },
    list: () => listMemory(backing.reviews, ReviewSchema),
  };
  const generationTasks: GenerationTaskRepository = {
    get: async (id) => readMemory(backing.generationTasks, id, GenerationTaskSchema),
    save: async (_tx, entity, expectedVersion) =>
      saveMemory(backing.generationTasks, entity, expectedVersion),
    list: () => listMemory(backing.generationTasks, GenerationTaskSchema),
  };
  return { courses, lessonSessions, reviews, generationTasks };
}
