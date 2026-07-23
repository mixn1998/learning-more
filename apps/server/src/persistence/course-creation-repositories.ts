import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import type { CourseCreationRepositories } from '../modules/course-authoring/ports/course-repositories.js';
import { mapConcurrentOrdered } from './concurrent-map.js';
import { DataRoot } from './data-root.js';
import { checksumJson, decodeAggregateDocument } from './json-codec.js';
import { createStorePaths } from './paths.js';
import { ImmutableResourceError, RepositoryVersionConflictError } from './repository-errors.js';

const CourseSchema = z.strictObject({
  id: z.string(),
  title: z.string(),
  courseMode: z.enum([
    'standard',
    'brainstorm',
    'argument_clash',
    'case_study',
    'business_insight',
    'process_decomposition',
    'decision_analysis',
    'cross_explore',
    'reading_seminar',
  ]),
  outlineVersionId: z.string(),
  lessonIds: z.array(z.string()),
  recommendedLessonId: z.string().optional(),
  nextLessonRecommendation: z
    .strictObject({
      versionId: z.string(),
      recommendedLessonId: z.string(),
      rankedLessonIds: z.array(z.string()),
      rationale: z.string(),
      evidenceRefs: z.array(z.string()),
      confidence: z.number().min(0).max(1),
      expiresAt: z.string(),
      sourceSnapshotHash: z.string(),
      status: z.enum(['current', 'stale', 'fallback']),
      warnings: z.array(z.string()),
    })
    .optional(),
  status: z.enum(['active', 'closed']),
  closedAt: z.string().optional(),
  createdAt: z.string(),
  resourceVersion: z.number().int().nonnegative(),
});
const OutlineSchema = z.strictObject({
  id: z.string(),
  courseId: z.string(),
  sourceCandidateVersionId: z.string(),
  outlineMarkdown: z.string(),
  disciplineTag: z.string(),
  topicTags: z.array(z.string()),
  createdAt: z.string(),
  resourceVersion: z.number().int().nonnegative(),
});
const LessonSchema = z.strictObject({
  id: z.string(),
  courseId: z.string(),
  outlineVersionId: z.string(),
  semanticKey: z.string(),
  title: z.string(),
  objective: z.string(),
  coreKnowledgePoints: z.array(z.string()),
  prerequisiteLessonIds: z.array(z.string()),
  estimatedMinutes: z.number().int(),
  sourceRefs: z.array(z.string()),
  resourceVersion: z.number().int().nonnegative(),
});

export function createLocalFileCourseCreationRepositories(
  dataRoot: DataRoot,
): CourseCreationRepositories {
  const paths = createStorePaths(dataRoot);
  async function read<TSchema extends z.ZodType>(type: string, id: string, schema: TSchema) {
    try {
      return decodeAggregateDocument(await readFile(paths.aggregate(type, id), 'utf8'), schema)
        .data;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }
  async function save(
    tx: Parameters<CourseCreationRepositories['courses']['save']>[0],
    type: string,
    id: string,
    data: unknown,
  ) {
    const absolute = paths.aggregate(type, id);
    await tx.stageJson(path.relative(dataRoot.absolutePath, absolute).replaceAll('\\', '/'), {
      schema: `learning-more/${type}`,
      schemaVersion: 1,
      entityType: type,
      entityId: id,
      resourceVersion: 1,
      createdAt: 'preserved-in-data',
      updatedAt: new Date().toISOString(),
      contentSha256: checksumJson(data),
      data,
    });
  }
  async function ids(type: string) {
    const root = path.join(dataRoot.absolutePath, 'entities', type);
    const result: string[] = [];
    for (const shard of await readdir(root, { withFileTypes: true }).catch(() => [])) {
      if (!shard.isDirectory()) continue;
      for (const file of await readdir(path.join(root, shard.name), { withFileTypes: true })) {
        if (file.isFile() && file.name.endsWith('.json')) result.push(file.name.slice(0, -5));
      }
    }
    return result.sort();
  }
  async function immutableSave(
    tx: Parameters<CourseCreationRepositories['courses']['save']>[0],
    type: string,
    id: string,
    value: { resourceVersion: number },
    expected: 0,
    current: unknown,
  ) {
    if (expected !== 0 || value.resourceVersion !== 0)
      throw new RepositoryVersionConflictError(current === undefined ? 0 : 1);
    if (current !== undefined) throw new ImmutableResourceError();
    await save(tx, type, id, { ...value, resourceVersion: 1 });
  }
  const courses: CourseCreationRepositories['courses'] = {
    get: (id) =>
      read('courses', id, CourseSchema) as ReturnType<CourseCreationRepositories['courses']['get']>,
    async *list() {
      for (const id of await ids('courses')) {
        const course = await courses.get(id);
        if (course !== undefined) yield course;
      }
    },
    async save(tx, value, expected) {
      const currentVersion = (await courses.get(value.id))?.resourceVersion ?? 0;
      if (currentVersion !== expected || value.resourceVersion !== expected) {
        throw new RepositoryVersionConflictError(currentVersion);
      }
      await save(tx, 'courses', value.id, { ...value, resourceVersion: expected + 1 });
    },
  };
  const outlineVersions: CourseCreationRepositories['outlineVersions'] = {
    get: (id) =>
      read('outline-versions', id, OutlineSchema) as ReturnType<
        CourseCreationRepositories['outlineVersions']['get']
      >,
    async *listByCourse(courseId) {
      for (const id of await ids('outline-versions')) {
        const outline = await outlineVersions.get(id);
        if (outline?.courseId === courseId) yield outline;
      }
    },
    async save(tx, value, expected) {
      await immutableSave(
        tx,
        'outline-versions',
        value.id,
        value,
        expected,
        await outlineVersions.get(value.id),
      );
    },
  };
  const lessons: CourseCreationRepositories['lessons'] = {
    get: (id) =>
      read('lesson-definitions', id, LessonSchema) as ReturnType<
        CourseCreationRepositories['lessons']['get']
      >,
    async save(tx, value, expected) {
      await immutableSave(
        tx,
        'lesson-definitions',
        value.id,
        value,
        expected,
        await lessons.get(value.id),
      );
    },
    async *list() {
      const values = await mapConcurrentOrdered(await ids('lesson-definitions'), (id) =>
        lessons.get(id),
      );
      for (const lesson of values) if (lesson !== undefined) yield lesson;
    },
    async *listByCourse(courseId) {
      for await (const lesson of lessons.list()) if (lesson.courseId === courseId) yield lesson;
    },
  };
  return { courses, outlineVersions, lessons };
}
