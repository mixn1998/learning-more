import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { LearningNoteRecord } from '../modules/learning-notes/learning-note-repository.js';
import { DataRoot } from './data-root.js';
import { createLocalFileLearningNoteRepository } from './learning-note-repository.js';
import { createUnitOfWork } from './unit-of-work.js';

async function collect(repository: ReturnType<typeof createLocalFileLearningNoteRepository>) {
  const notes: LearningNoteRecord[] = [];
  for await (const note of repository.list()) notes.push(note);
  return notes;
}

describe('learning note repository index', () => {
  it('reuses its in-memory index until a committed note mutation invalidates it', async () => {
    const dataRoot = DataRoot.create(await mkdtemp(path.join(os.tmpdir(), 'learning-notes-')));
    const unitOfWork = createUnitOfWork({ dataRoot });
    const indexed = createLocalFileLearningNoteRepository(dataRoot);
    const writer = createLocalFileLearningNoteRepository(dataRoot);
    const original: LearningNoteRecord = {
      id: 'note_01',
      title: '单侧极限',
      markdown: '原始笔记',
      discipline: '数学',
      courseId: 'course_01',
      courseTitle: '微积分',
      lessonId: 'lesson_01',
      lessonTitle: '单侧极限',
      createdAt: '2026-07-29T00:00:00.000Z',
      updatedAt: '2026-07-29T00:00:00.000Z',
      resourceVersion: 0,
    };
    await unitOfWork.execute({ transactionId: 'tx_note_create' }, (transaction) =>
      writer.save(transaction, original, 0),
    );

    await expect(collect(indexed)).resolves.toMatchObject([{ markdown: '原始笔记' }]);
    await unitOfWork.execute({ transactionId: 'tx_note_update' }, (transaction) =>
      writer.save(
        transaction,
        {
          ...original,
          markdown: '更新后的笔记',
          resourceVersion: 1,
        },
        1,
      ),
    );

    await expect(collect(indexed)).resolves.toMatchObject([{ markdown: '原始笔记' }]);
    indexed.invalidateList();
    await expect(collect(indexed)).resolves.toMatchObject([{ markdown: '更新后的笔记' }]);
  });
});
