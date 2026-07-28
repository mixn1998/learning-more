import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import type {
  LearningNoteRecord,
  LearningNoteRepository,
} from '../modules/learning-notes/learning-note-repository.js';
import { DataRoot } from './data-root.js';
import { checksumJson, decodeAggregateDocument } from './json-codec.js';
import { createStorePaths } from './paths.js';
import { RepositoryVersionConflictError } from './repository-errors.js';

const LearningNoteRecordSchema = z.strictObject({
  id: z.string().min(1),
  markdown: z.string().min(1),
  discipline: z.string().min(1),
  courseId: z.string().min(1),
  courseTitle: z.string().min(1),
  lessonId: z.string().min(1),
  lessonTitle: z.string().min(1),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  resourceVersion: z.number().int().positive(),
});

async function listIds(dataRoot: DataRoot): Promise<string[]> {
  const root = path.join(dataRoot.absolutePath, 'entities', 'learning-notes');
  const ids: string[] = [];
  for (const shard of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!shard.isDirectory()) continue;
    for (const file of await readdir(path.join(root, shard.name), { withFileTypes: true })) {
      if (file.isFile() && file.name.endsWith('.json')) ids.push(file.name.slice(0, -5));
    }
  }
  return ids.sort();
}

export function createLocalFileLearningNoteRepository(dataRoot: DataRoot): LearningNoteRepository {
  const paths = createStorePaths(dataRoot);
  const repository: LearningNoteRepository = {
    async get(noteId) {
      try {
        return decodeAggregateDocument(
          await readFile(paths.aggregate('learning-notes', noteId), 'utf8'),
          LearningNoteRecordSchema,
        ).data as LearningNoteRecord;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
      }
    },
    async *list(filter = {}) {
      const notes: LearningNoteRecord[] = [];
      for (const id of await listIds(dataRoot)) {
        const note = await repository.get(id);
        if (note === undefined) continue;
        if (filter.courseId !== undefined && note.courseId !== filter.courseId) continue;
        if (filter.lessonId !== undefined && note.lessonId !== filter.lessonId) continue;
        notes.push(note);
      }
      notes.sort(
        (left, right) =>
          Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
          right.id.localeCompare(left.id),
      );
      yield* notes;
    },
    async save(tx, note, expectedVersion) {
      const current = await repository.get(note.id);
      const currentVersion = current?.resourceVersion ?? 0;
      if (currentVersion !== expectedVersion || note.resourceVersion !== expectedVersion) {
        throw new RepositoryVersionConflictError(currentVersion);
      }
      const data = { ...note, resourceVersion: expectedVersion + 1 };
      const absolute = paths.aggregate('learning-notes', note.id);
      await tx.stageJson(path.relative(dataRoot.absolutePath, absolute).replaceAll('\\', '/'), {
        schema: 'learning-more/learning-note',
        schemaVersion: 1,
        entityType: 'learning-notes',
        entityId: note.id,
        resourceVersion: data.resourceVersion,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
        contentSha256: checksumJson(data),
        data,
      });
    },
    async remove(tx, noteId, expectedVersion) {
      const current = await repository.get(noteId);
      if (current === undefined) {
        throw Object.assign(new Error('resource_not_found'), { code: 'resource_not_found' });
      }
      if (current.resourceVersion !== expectedVersion) {
        throw new RepositoryVersionConflictError(current.resourceVersion);
      }
      const absolute = paths.aggregate('learning-notes', noteId);
      await tx.deleteOnCommit(path.relative(dataRoot.absolutePath, absolute).replaceAll('\\', '/'));
    },
  };
  return repository;
}
