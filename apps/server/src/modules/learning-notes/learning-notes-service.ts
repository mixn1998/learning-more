import { randomUUID } from 'node:crypto';

import type { LearningNoteView } from '@learning-more/contracts';

import type { CourseAccess } from '../../bootstrap/local-application/course-runtime.js';
import type { UnitOfWork } from '../../persistence/unit-of-work.js';
import type { LearningNoteRecord, LearningNoteRepository } from './learning-note-repository.js';

export type LearningNotesService = Readonly<{
  list(filter?: Readonly<{ courseId?: string; lessonId?: string }>): Promise<LearningNoteView[]>;
  create(
    input: Readonly<{
      courseId: string;
      lessonId: string;
      title?: string | undefined;
      markdown: string;
    }>,
  ): Promise<LearningNoteView>;
  update(
    noteId: string,
    input: Readonly<{ title: string; markdown: string }>,
    expectedVersion: number,
  ): Promise<LearningNoteView>;
  remove(noteId: string, expectedVersion: number): Promise<void>;
}>;

function view(note: LearningNoteRecord): LearningNoteView {
  return { ...note, title: note.title?.trim() || note.lessonTitle };
}

export function createLearningNotesService(
  input: Readonly<{
    repository: LearningNoteRepository;
    unitOfWork: UnitOfWork;
    courses: CourseAccess;
    now: () => Date;
  }>,
): LearningNotesService {
  return {
    async list(filter = {}) {
      const result: LearningNoteView[] = [];
      for await (const note of input.repository.list(filter)) result.push(view(note));
      return result;
    },
    async create(command) {
      const lesson = await input.courses.getLesson(command.lessonId);
      const course = await input.courses.getCourse(command.courseId);
      if (lesson === undefined || course === undefined || lesson.courseId !== command.courseId) {
        throw Object.assign(new Error('resource_not_found'), { code: 'resource_not_found' });
      }
      const outline = await input.courses.getOutlineVersion(course.outlineVersionId);
      const timestamp = input.now().toISOString();
      const record: LearningNoteRecord = {
        id: `note_${randomUUID()}`,
        title: command.title?.trim() || lesson.title,
        markdown: command.markdown.trim(),
        discipline: outline?.disciplineTag.trim() || '未分类学科',
        courseId: course.id,
        courseTitle: course.title,
        lessonId: lesson.id,
        lessonTitle: lesson.title,
        createdAt: timestamp,
        updatedAt: timestamp,
        resourceVersion: 0,
      };
      await input.unitOfWork.execute({ transactionId: `tx_learning_note_${randomUUID()}` }, (tx) =>
        input.repository.save(tx, record, 0),
      );
      input.repository.invalidateList();
      return view({ ...record, resourceVersion: 1 });
    },
    async update(noteId, command, expectedVersion) {
      const current = await input.repository.get(noteId);
      if (current === undefined) {
        throw Object.assign(new Error('resource_not_found'), { code: 'resource_not_found' });
      }
      const updated: LearningNoteRecord = {
        ...current,
        title: command.title.trim(),
        markdown: command.markdown.trim(),
        updatedAt: input.now().toISOString(),
      };
      await input.unitOfWork.execute({ transactionId: `tx_learning_note_${randomUUID()}` }, (tx) =>
        input.repository.save(tx, updated, expectedVersion),
      );
      input.repository.invalidateList();
      return view({ ...updated, resourceVersion: expectedVersion + 1 });
    },
    async remove(noteId, expectedVersion) {
      await input.unitOfWork.execute({ transactionId: `tx_learning_note_${randomUUID()}` }, (tx) =>
        input.repository.remove(tx, noteId, expectedVersion),
      );
      input.repository.invalidateList();
    },
  };
}
