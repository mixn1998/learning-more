import type { TransactionContext } from '../../persistence/unit-of-work.js';

export type LearningNoteRecord = Readonly<{
  id: string;
  title?: string;
  markdown: string;
  discipline: string;
  courseId: string;
  courseTitle: string;
  lessonId: string;
  lessonTitle: string;
  createdAt: string;
  updatedAt: string;
  resourceVersion: number;
}>;

export interface LearningNoteRepository {
  get(noteId: string): Promise<LearningNoteRecord | undefined>;
  list(
    filter?: Readonly<{ courseId?: string; lessonId?: string }>,
  ): AsyncIterable<LearningNoteRecord>;
  save(tx: TransactionContext, note: LearningNoteRecord, expectedVersion: number): Promise<void>;
  remove(tx: TransactionContext, noteId: string, expectedVersion: number): Promise<void>;
  invalidateList(): void;
}
