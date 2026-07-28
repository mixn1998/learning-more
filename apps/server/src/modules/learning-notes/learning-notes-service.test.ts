import { describe, expect, it } from 'vitest';

import type { CourseAccess } from '../../bootstrap/local-application/course-runtime.js';
import type { UnitOfWork } from '../../persistence/unit-of-work.js';
import type { LearningNoteRecord, LearningNoteRepository } from './learning-note-repository.js';
import { createLearningNotesService } from './learning-notes-service.js';

function fixture() {
  const records = new Map<string, LearningNoteRecord>();
  const repository: LearningNoteRepository = {
    async get(noteId) {
      return records.get(noteId);
    },
    async *list(filter = {}) {
      for (const record of records.values()) {
        if (filter.courseId !== undefined && record.courseId !== filter.courseId) continue;
        if (filter.lessonId !== undefined && record.lessonId !== filter.lessonId) continue;
        yield record;
      }
    },
    async save(_tx, note, expectedVersion) {
      records.set(note.id, { ...note, resourceVersion: expectedVersion + 1 });
    },
    async remove(_tx, noteId) {
      records.delete(noteId);
    },
  };
  const transaction = {
    stageJson: async () => undefined,
    stageText: async () => undefined,
    deleteOnCommit: async () => undefined,
  };
  const unitOfWork = {
    async execute<T>(_request: unknown, work: (tx: typeof transaction) => Promise<T>) {
      return work(transaction);
    },
  } as unknown as UnitOfWork;
  const courses = {
    getLesson: async () => ({
      id: 'lesson_01',
      courseId: 'course_01',
      title: '单侧极限',
    }),
    getCourse: async () => ({
      id: 'course_01',
      title: '微积分',
      outlineVersionId: 'outline_01',
    }),
    getOutlineVersion: async () => ({ disciplineTag: '数学' }),
  } as unknown as CourseAccess;
  return { records, repository, unitOfWork, courses };
}

describe('learning notes service', () => {
  it('uses the lesson title for legacy notes that predate customizable titles', async () => {
    const setup = fixture();
    setup.records.set('note_legacy', {
      id: 'note_legacy',
      markdown: '旧笔记内容',
      discipline: '数学',
      courseId: 'course_01',
      courseTitle: '微积分',
      lessonId: 'lesson_01',
      lessonTitle: '单侧极限',
      createdAt: '2026-07-27T08:00:00.000Z',
      updatedAt: '2026-07-27T08:00:00.000Z',
      resourceVersion: 1,
    });
    const service = createLearningNotesService({
      repository: setup.repository,
      unitOfWork: setup.unitOfWork,
      courses: setup.courses,
      now: () => new Date('2026-07-28T08:00:00.000Z'),
    });

    await expect(service.list()).resolves.toMatchObject([{ title: '单侧极限' }]);
  });

  it('snapshots course metadata so notes remain readable without the source course', async () => {
    const setup = fixture();
    const service = createLearningNotesService({
      repository: setup.repository,
      unitOfWork: setup.unitOfWork,
      courses: setup.courses,
      now: () => new Date('2026-07-28T08:00:00.000Z'),
    });

    const created = await service.create({
      courseId: 'course_01',
      lessonId: 'lesson_01',
      markdown: ' 左右极限都存在且相等，双侧极限才存在。 ',
    });

    expect(created).toMatchObject({
      title: '单侧极限',
      markdown: '左右极限都存在且相等，双侧极限才存在。',
      discipline: '数学',
      courseTitle: '微积分',
      lessonTitle: '单侧极限',
      resourceVersion: 1,
    });
    const listed = await service.list();
    expect(listed).toEqual([created]);
  });

  it('updates and deletes each note with its own resource version', async () => {
    const setup = fixture();
    const service = createLearningNotesService({
      repository: setup.repository,
      unitOfWork: setup.unitOfWork,
      courses: setup.courses,
      now: () => new Date('2026-07-28T08:00:00.000Z'),
    });
    const created = await service.create({
      courseId: 'course_01',
      lessonId: 'lesson_01',
      markdown: '原始笔记',
    });

    const updated = await service.update(
      created.id,
      { title: '左右极限的单侧判据', markdown: '修订笔记' },
      created.resourceVersion,
    );
    expect(updated).toMatchObject({
      title: '左右极限的单侧判据',
      markdown: '修订笔记',
      resourceVersion: 2,
    });

    await service.remove(updated.id, updated.resourceVersion);
    expect(await service.list()).toEqual([]);
  });
});
