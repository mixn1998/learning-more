// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { LearningNoteView } from '@learning-more/contracts';

import type { LearningNotesClient } from '../../client/learning-notes-client.js';
import { LessonNotesPanel } from './lesson-notes-panel.js';

function note(id: string, markdown: string, resourceVersion = 1): LearningNoteView {
  return {
    id,
    markdown,
    discipline: '数学',
    courseId: 'course_01',
    courseTitle: '微积分',
    lessonId: 'lesson_01',
    lessonTitle: '单侧极限',
    createdAt: '2026-07-28T08:00:00.000Z',
    updatedAt: '2026-07-28T08:00:00.000Z',
    resourceVersion,
  };
}

function client(overrides: Partial<LearningNotesClient> = {}): LearningNotesClient {
  return {
    list: vi.fn().mockResolvedValue([note('note_01', '左右两侧需要分别观察。')]),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('LessonNotesPanel', () => {
  it('keeps prior notes visible while saving each new note independently', async () => {
    const api = client({
      create: vi.fn().mockResolvedValue(note('note_02', '双侧极限要求左右结果一致。')),
    });
    render(<LessonNotesPanel courseId="course_01" lessonId="lesson_01" client={api} />);

    expect(await screen.findByText('左右两侧需要分别观察。')).toBeVisible();
    fireEvent.change(screen.getByRole('textbox', { name: '记录本课笔记' }), {
      target: { value: '双侧极限要求左右结果一致。' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(await screen.findByText('双侧极限要求左右结果一致。')).toBeVisible();
    expect(screen.getByText('左右两侧需要分别观察。')).toBeVisible();
    expect(screen.getByRole('textbox', { name: '记录本课笔记' })).toHaveValue('');
  });

  it('retains the lesson draft when saving fails', async () => {
    const api = client({ create: vi.fn().mockRejectedValue(new Error('offline')) });
    render(<LessonNotesPanel courseId="course_01" lessonId="lesson_01" client={api} />);

    const composer = screen.getByRole('textbox', { name: '记录本课笔记' });
    fireEvent.change(composer, { target: { value: '尚未保存的重要理解' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('保存失败，草稿已保留。');
    expect(composer).toHaveValue('尚未保存的重要理解');
    expect(localStorage.getItem('learning-more:note-draft:course_01:lesson_01')).toBe(
      '尚未保存的重要理解',
    );
  });

  it('edits and deletes one saved note without changing the others', async () => {
    const first = note('note_01', '第一条');
    const second = note('note_02', '第二条');
    const api = client({
      list: vi.fn().mockResolvedValue([second, first]),
      update: vi.fn().mockResolvedValue(note('note_01', '第一条（修订）', 2)),
      remove: vi.fn().mockResolvedValue(undefined),
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<LessonNotesPanel courseId="course_01" lessonId="lesson_01" client={api} />);

    await screen.findByText('第一条');
    const firstItem = screen.getByText('第一条').closest('article')!;
    fireEvent.click(firstItem.querySelector('button')!);
    fireEvent.change(screen.getByRole('textbox', { name: '编辑笔记' }), {
      target: { value: '第一条（修订）' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));

    await waitFor(() =>
      expect(screen.queryByRole('textbox', { name: '编辑笔记' })).not.toBeInTheDocument(),
    );
    expect(screen.getByText('第一条（修订）', { selector: 'p' })).toBeVisible();
    expect(screen.getByText('第二条')).toBeVisible();

    const secondItem = screen.getByText('第二条').closest('article')!;
    fireEvent.click(
      [...secondItem.querySelectorAll('button')].find((button) => button.textContent === '删除')!,
    );
    await waitFor(() => expect(screen.queryByText('第二条')).not.toBeInTheDocument());
    expect(screen.getByText('第一条（修订）', { selector: 'p' })).toBeVisible();
  });
});
