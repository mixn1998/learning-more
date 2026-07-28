// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { LearningNoteView } from '@learning-more/contracts';

import type { LearningNotesClient } from '../../client/learning-notes-client.js';
import { NotesPage } from './notes-page.js';

function note(
  id: string,
  input: Pick<
    LearningNoteView,
    | 'discipline'
    | 'courseId'
    | 'courseTitle'
    | 'lessonId'
    | 'lessonTitle'
    | 'markdown'
    | 'createdAt'
  >,
): LearningNoteView {
  return {
    id,
    updatedAt: input.createdAt,
    resourceVersion: 1,
    ...input,
  };
}

const notes: LearningNoteView[] = [
  note('note_limit', {
    discipline: '数学',
    courseId: 'course_calculus',
    courseTitle: '微积分',
    lessonId: 'lesson_limit',
    lessonTitle: '单侧极限',
    markdown: '左右两侧需要分别观察。',
    createdAt: '2026-07-27T08:00:00.000Z',
  }),
  note('note_continuity', {
    discipline: '数学',
    courseId: 'course_calculus',
    courseTitle: '微积分',
    lessonId: 'lesson_continuity',
    lessonTitle: '连续性',
    markdown: '函数值与极限值需要建立一致关系。',
    createdAt: '2026-07-28T08:00:00.000Z',
  }),
  note('note_graph', {
    discipline: '计算机科学',
    courseId: 'course_algorithms',
    courseTitle: '数据结构与算法',
    lessonId: 'lesson_graph',
    lessonTitle: '图结构',
    markdown: '拓扑排序依赖有向无环图。',
    createdAt: '2026-07-26T08:00:00.000Z',
  }),
];

function client(overrides: Partial<LearningNotesClient> = {}): LearningNotesClient {
  return {
    list: vi.fn().mockResolvedValue(notes),
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

describe('NotesPage', () => {
  it('organizes notes into a discipline, course, and lesson directory', async () => {
    render(<NotesPage client={client()} />);

    expect(await screen.findByRole('navigation', { name: '学习笔记知识目录' })).toBeVisible();
    expect(await screen.findByRole('heading', { level: 2, name: '微积分' })).toBeVisible();
    expect(screen.getByText('2 条笔记')).toBeVisible();

    const directory = screen.getByRole('navigation', { name: '学习笔记知识目录' });
    expect(within(directory).getByRole('button', { name: '收起数学' })).toBeVisible();
    expect(within(directory).getByRole('button', { name: '收起微积分' })).toBeVisible();

    fireEvent.click(within(directory).getByRole('button', { name: /单侧极限/ }));

    expect(await screen.findByRole('heading', { level: 2, name: '单侧极限' })).toBeVisible();
    expect(screen.getByText('左右两侧需要分别观察。')).toBeVisible();
    expect(screen.queryByText('函数值与极限值需要建立一致关系。')).not.toBeInTheDocument();
  });

  it('searches within the selected directory and can expand to all notes', async () => {
    render(<NotesPage client={client()} />);
    const directory = await screen.findByRole('navigation', { name: '学习笔记知识目录' });

    fireEvent.click(within(directory).getByRole('button', { name: /全部笔记/ }));
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索当前目录笔记' }), {
      target: { value: '拓扑' },
    });

    expect(screen.getByText('拓扑排序依赖有向无环图。')).toBeVisible();
    expect(screen.queryByText('左右两侧需要分别观察。')).not.toBeInTheDocument();
    expect(screen.getByText('1 条笔记')).toBeVisible();
  });

  it('keeps editing and deletion available from the reorganized note stream', async () => {
    const api = client({
      update: vi.fn().mockResolvedValue({
        ...notes[1]!,
        markdown: '连续要求函数值与极限值相等。',
        resourceVersion: 2,
      }),
      remove: vi.fn().mockResolvedValue(undefined),
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<NotesPage client={api} />);

    await screen.findByRole('heading', { level: 2, name: '微积分' });
    const noteText = await screen.findByText('函数值与极限值需要建立一致关系。');
    const item = noteText.closest('article')!;
    fireEvent.click(within(item).getByRole('button', { name: '编辑' }));
    fireEvent.change(screen.getByRole('textbox', { name: '编辑学习笔记' }), {
      target: { value: '连续要求函数值与极限值相等。' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));

    expect(
      await screen.findByText('连续要求函数值与极限值相等。', { selector: 'p' }),
    ).toBeVisible();
    const updatedItem = screen
      .getByText('连续要求函数值与极限值相等。', { selector: 'p' })
      .closest('article')!;
    fireEvent.click(within(updatedItem).getByRole('button', { name: '删除' }));
    await waitFor(() =>
      expect(screen.queryByText('连续要求函数值与极限值相等。')).not.toBeInTheDocument(),
    );
  });
});
