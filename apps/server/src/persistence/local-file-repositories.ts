import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import type { CourseRepository } from '../modules/course-authoring/ports/course-repository.js';
import type { GenerationTaskRepository } from '../modules/generation-runtime/ports/generation-task-repository.js';
import type { LessonSessionRepository } from '../modules/learning-session/ports/lesson-session-repository.js';
import type { ReviewRepository } from '../modules/learning-session/ports/review-repository.js';
import { DataRoot } from './data-root.js';
import { checksumJson, decodeAggregateDocument, StorageDocumentError } from './json-codec.js';
import { createStorePaths, type StorePaths } from './paths.js';
import type { TransactionContext } from './unit-of-work.js';
import { ImmutableResourceError, RepositoryVersionConflictError } from './repository-errors.js';

export { ImmutableResourceError, RepositoryVersionConflictError } from './repository-errors.js';

const timestampSchema = z.string().min(1);
const versionSchema = z.number().int().nonnegative();

const CourseSchema = z.strictObject({
  id: z.string().min(1),
  title: z.string(),
  status: z.enum(['active', 'closed']),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  resourceVersion: versionSchema,
});

const LessonSessionSchema = z.strictObject({
  id: z.string().min(1),
  lessonId: z.string().min(1),
  status: z.enum(['active', 'paused', 'abandoned', 'completed']),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  resourceVersion: versionSchema,
});

const ReviewSchema = z.strictObject({
  id: z.string().min(1),
  lessonId: z.string().min(1),
  status: z.enum(['stage', 'final']),
  artifactId: z.string().min(1),
  immutable: z.boolean(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  resourceVersion: versionSchema,
});

const GenerationTaskSchema = z.strictObject({
  id: z.string().min(1),
  taskKey: z.string().min(1),
  status: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled', 'timeout']),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  resourceVersion: versionSchema,
  taskKind: z.string().optional(),
  taskGroup: z.enum(['interactive', 'background']).optional(),
  ownerRef: z.string().optional(),
  inputSnapshotHash: z.string().optional(),
  priority: z.number().optional(),
  providerId: z.string().optional(),
  model: z.string().optional(),
  reasoningEffort: z.string().optional(),
  fallbackProviderIds: z.array(z.string()).optional(),
  maxAttempts: z.number().int().positive().optional(),
  attempts: z
    .array(
      z.strictObject({
        providerId: z.string(),
        model: z.string().optional(),
        startedAt: timestampSchema,
        completedAt: timestampSchema.optional(),
        status: z.enum(['running', 'completed', 'failed']),
        errorCode: z.string().optional(),
        emittedDelta: z.boolean(),
      }),
    )
    .optional(),
  prompt: z.string().optional(),
  draftMarkdown: z.string().optional(),
  resultRef: z.string().optional(),
  errorCode: z.string().optional(),
  leaseExpiresAt: z.string().optional(),
});

export interface LocalFileRepositories {
  readonly courses: CourseRepository;
  readonly lessonSessions: LessonSessionRepository;
  readonly reviews: ReviewRepository;
  readonly generationTasks: GenerationTaskRepository;
}

async function readEntity<TSchema extends z.ZodType>(
  dataRoot: DataRoot,
  paths: StorePaths,
  entityType: string,
  entityId: string,
  schema: TSchema,
): Promise<z.output<TSchema> | undefined> {
  let text: string;
  try {
    text = await readFile(paths.aggregate(entityType, entityId), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  const document = decodeAggregateDocument(text, schema);
  if (document.entityType !== entityType || document.entityId !== entityId) {
    throw new StorageDocumentError('storage_corrupted');
  }
  return document.data;
}

function relativePath(dataRoot: DataRoot, absolutePath: string): string {
  return path.relative(dataRoot.absolutePath, absolutePath).replaceAll('\\', '/');
}

async function saveEntity<
  TEntity extends { id: string; resourceVersion: number; createdAt: string; updatedAt: string },
>(
  tx: TransactionContext,
  dataRoot: DataRoot,
  paths: StorePaths,
  entityType: string,
  entity: TEntity,
  expectedVersion: number,
  current: TEntity | undefined,
): Promise<void> {
  const currentVersion = current?.resourceVersion ?? 0;
  if (currentVersion !== expectedVersion || entity.resourceVersion !== expectedVersion) {
    throw new RepositoryVersionConflictError(currentVersion);
  }
  const data = { ...entity, resourceVersion: expectedVersion + 1 };
  await tx.stageJson(relativePath(dataRoot, paths.aggregate(entityType, entity.id)), {
    schema: `learning-more/${entityType}`,
    schemaVersion: 1,
    entityType,
    entityId: entity.id,
    resourceVersion: expectedVersion + 1,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
    contentSha256: checksumJson(data),
    data,
  });
}

async function listEntityIds(dataRoot: DataRoot, entityType: string): Promise<string[]> {
  const directory = path.join(dataRoot.absolutePath, 'entities', entityType);
  const shards = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const ids: string[] = [];
  for (const shard of shards) {
    if (!shard.isDirectory()) continue;
    const files = await readdir(path.join(directory, shard.name), { withFileTypes: true });
    for (const file of files) {
      if (file.isFile() && file.name.endsWith('.json')) ids.push(file.name.slice(0, -5));
    }
  }
  return ids.sort();
}

export function createLocalFileRepositories(dataRoot: DataRoot): LocalFileRepositories {
  const paths = createStorePaths(dataRoot);
  const courses: CourseRepository = {
    get: (id) => readEntity(dataRoot, paths, 'courses', id, CourseSchema),
    async save(tx, entity, expectedVersion) {
      await saveEntity(
        tx,
        dataRoot,
        paths,
        'courses',
        entity,
        expectedVersion,
        await courses.get(entity.id),
      );
    },
    async *list(query) {
      let count = 0;
      for (const id of await listEntityIds(dataRoot, 'courses')) {
        if (query.limit !== undefined && count >= query.limit) return;
        const entity = await courses.get(id);
        if (entity !== undefined) {
          count += 1;
          yield entity;
        }
      }
    },
  };
  const lessonSessions: LessonSessionRepository = {
    get: (id) => readEntity(dataRoot, paths, 'lesson-sessions', id, LessonSessionSchema),
    async save(tx, entity, expectedVersion) {
      await saveEntity(
        tx,
        dataRoot,
        paths,
        'lesson-sessions',
        entity,
        expectedVersion,
        await lessonSessions.get(entity.id),
      );
    },
    async *list() {
      for (const id of await listEntityIds(dataRoot, 'lesson-sessions')) {
        const entity = await lessonSessions.get(id);
        if (entity !== undefined) yield entity;
      }
    },
  };
  const reviews: ReviewRepository = {
    get: (id) => readEntity(dataRoot, paths, 'reviews', id, ReviewSchema),
    async save(tx, entity, expectedVersion) {
      const current = await reviews.get(entity.id);
      if (current?.immutable === true || current?.status === 'final')
        throw new ImmutableResourceError();
      await saveEntity(tx, dataRoot, paths, 'reviews', entity, expectedVersion, current);
    },
    async *list() {
      for (const id of await listEntityIds(dataRoot, 'reviews')) {
        const entity = await reviews.get(id);
        if (entity !== undefined) yield entity;
      }
    },
  };
  const generationTasks: GenerationTaskRepository = {
    get: (id) => readEntity(dataRoot, paths, 'tasks', id, GenerationTaskSchema),
    async save(tx, entity, expectedVersion) {
      await saveEntity(
        tx,
        dataRoot,
        paths,
        'tasks',
        entity,
        expectedVersion,
        await generationTasks.get(entity.id),
      );
    },
    async *list() {
      for (const id of await listEntityIds(dataRoot, 'tasks')) {
        const entity = await generationTasks.get(id);
        if (entity !== undefined) yield entity;
      }
    },
  };
  return { courses, lessonSessions, reviews, generationTasks };
}
