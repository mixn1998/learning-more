import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import type {
  LearningNoteRecord,
  LearningNoteRepository,
} from '../modules/learning-notes/learning-note-repository.js';
import { DataRoot } from './data-root.js';
import { mapConcurrentOrdered } from './concurrent-map.js';
import { checksumJson, decodeAggregateDocument } from './json-codec.js';
import { createStorePaths } from './paths.js';
import { RepositoryVersionConflictError } from './repository-errors.js';

const LearningNoteRecordSchema = z.strictObject({
  id: z.string().min(1),
  title: z.string().min(1).optional(),
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
  type NoteIndex = Readonly<{
    all: readonly LearningNoteRecord[];
    byId: ReadonlyMap<string, LearningNoteRecord>;
    byCourse: ReadonlyMap<string, readonly LearningNoteRecord[]>;
    byLesson: ReadonlyMap<string, readonly LearningNoteRecord[]>;
  }>;
  let index: NoteIndex | undefined;
  let indexBuild: Promise<NoteIndex> | undefined;
  let indexGeneration = 0;

  async function readOne(noteId: string): Promise<LearningNoteRecord | undefined> {
    try {
      return decodeAggregateDocument(
        await readFile(paths.aggregate('learning-notes', noteId), 'utf8'),
        LearningNoteRecordSchema,
      ).data as LearningNoteRecord;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async function currentIndex(): Promise<NoteIndex> {
    if (index !== undefined) return index;
    if (indexBuild !== undefined) return indexBuild;
    const generation = indexGeneration;
    const build = (async () => {
      const loaded = (
        await mapConcurrentOrdered(await listIds(dataRoot), (id) => readOne(id), 8)
      ).filter((note) => note !== undefined);
      loaded.sort(
        (left, right) =>
          Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
          right.id.localeCompare(left.id),
      );
      const byCourse = new Map<string, LearningNoteRecord[]>();
      const byLesson = new Map<string, LearningNoteRecord[]>();
      for (const note of loaded) {
        byCourse.set(note.courseId, [...(byCourse.get(note.courseId) ?? []), note]);
        byLesson.set(note.lessonId, [...(byLesson.get(note.lessonId) ?? []), note]);
      }
      const built: NoteIndex = {
        all: loaded,
        byId: new Map(loaded.map((note) => [note.id, note])),
        byCourse,
        byLesson,
      };
      if (generation === indexGeneration) index = built;
      return built;
    })();
    indexBuild = build;
    try {
      return await build;
    } finally {
      if (indexBuild === build) indexBuild = undefined;
    }
  }

  const repository: LearningNoteRepository = {
    async get(noteId) {
      return index?.byId.get(noteId) ?? readOne(noteId);
    },
    async *list(filter = {}) {
      const loaded = await currentIndex();
      const notes =
        filter.lessonId !== undefined
          ? (loaded.byLesson.get(filter.lessonId) ?? [])
          : filter.courseId !== undefined
            ? (loaded.byCourse.get(filter.courseId) ?? [])
            : loaded.all;
      const filtered =
        filter.courseId === undefined
          ? notes
          : notes.filter((note) => note.courseId === filter.courseId);
      yield* filtered;
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
    invalidateList() {
      indexGeneration += 1;
      index = undefined;
    },
  };
  return repository;
}
