// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { LearningClient } from '../../client/learning-client.js';
import { CoursePage } from './course-page.js';

afterEach(cleanup);

describe('CoursePage', () => {
  it('[EQ-COURSE-01] closes an eligible course and exposes its immutable topic summary only from the course archive', async () => {
    const closeCourse = vi.fn().mockResolvedValue({
      state: 'review-finalized',
      artifactRef: 'course_review_course_01',
      markdown:
        '# 主题总结\n## 核心知识线索\nProbability\n## 总体学习表现\nEvidence based\n## 推荐扩展课程\nBayesian inference',
      resourceVersion: 2,
    });
    render(
      <CoursePage
        courseId="course_01"
        client={
          {
            getCourse: vi.fn().mockResolvedValue({
              courseId: 'course_01',
              title: 'Probability',
              status: 'active',
              courseMode: 'standard',
              outlineVersionId: 'outline_01',
              lessonIds: ['lesson_01'],
              resourceVersion: 1,
            }),
            deleteCourse: vi.fn(),
            closeCourse,
            getCourseReview: vi.fn().mockResolvedValue(undefined),
          } as unknown as LearningClient
        }
      />,
    );

    await screen.findByText('Probability');
    const close = screen.getByRole('button', { name: '确认关闭课程' });
    fireEvent.click(close);
    fireEvent.click(close);

    const openSummary = await screen.findByRole('button', { name: '查看主题总结' });
    fireEvent.click(openSummary);
    expect(screen.getByRole('heading', { name: '主题总结' })).toBeInTheDocument();
    expect(screen.getByText(/核心知识线索/)).toBeInTheDocument();
    expect(screen.getByText(/总体学习表现/)).toBeInTheDocument();
    expect(screen.getByText(/推荐扩展课程/)).toBeInTheDocument();
    expect(closeCourse).toHaveBeenCalledTimes(1);
    expect(document.body).not.toHaveTextContent('course_review_course_01');
  });

  it('[EQ-COURSE-06] confirms the irreversible cascade once and delegates successful home navigation', async () => {
    let resolveDelete!: (value: {
      courseId: string;
      deletedAt: string;
      portraitRefresh: 'updating';
    }) => void;
    const deleteCourse = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        resolveDelete = resolve;
      }),
    );
    const onDeleted = vi.fn();
    render(
      <CoursePage
        courseId="course_01"
        onDeleted={onDeleted}
        client={
          {
            getCourse: vi.fn().mockResolvedValue({
              courseId: 'course_01',
              title: 'Probability',
              status: 'active',
              courseMode: 'standard',
              outlineVersionId: 'outline_01',
              lessonIds: ['lesson_01'],
              resourceVersion: 4,
            }),
            deleteCourse,
            closeCourse: vi.fn(),
            getCourseReview: vi.fn().mockResolvedValue(undefined),
          } as unknown as LearningClient
        }
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: '删除课程' }));
    const dialog = screen.getByRole('dialog', { name: '永久删除课程？' });
    expect(dialog).toHaveTextContent('课程档案');
    expect(dialog).toHaveTextContent('学习记录');
    expect(dialog).toHaveTextContent('Review');
    expect(dialog).toHaveTextContent('排期');
    expect(dialog).toHaveTextContent('历史统计');
    expect(dialog).toHaveTextContent('学习画像');
    expect(screen.queryByRole('textbox', { name: /课程名称/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(deleteCourse).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '删除课程' }));
    const permanentDelete = screen.getByRole('button', { name: '永久删除' });
    fireEvent.click(permanentDelete);
    fireEvent.click(permanentDelete);
    expect(permanentDelete).toBeDisabled();
    expect(deleteCourse).toHaveBeenCalledTimes(1);
    expect(deleteCourse).toHaveBeenCalledWith('course_01', 4);

    resolveDelete({
      courseId: 'course_01',
      deletedAt: '2026-07-13T08:01:00.000Z',
      portraitRefresh: 'updating',
    });
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith('课程及关联记录已永久删除'));
  });

  it('keeps the archive and dialog available when permanent deletion fails', async () => {
    const deleteCourse = vi.fn().mockRejectedValue({ code: 'storage_corrupted' });
    render(
      <CoursePage
        courseId="course_01"
        client={
          {
            getCourse: vi.fn().mockResolvedValue({
              courseId: 'course_01',
              title: 'Probability',
              status: 'closed',
              courseMode: 'standard',
              outlineVersionId: 'outline_01',
              lessonIds: ['lesson_01'],
              resourceVersion: 7,
            }),
            deleteCourse,
            closeCourse: vi.fn(),
            getCourseReview: vi.fn().mockResolvedValue({
              state: 'review-finalized',
              resourceVersion: 1,
            }),
          } as unknown as LearningClient
        }
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: '删除课程' }));
    fireEvent.click(screen.getByRole('button', { name: '永久删除' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('课程及现有数据已完整保留');
    expect(screen.getByRole('dialog', { name: '永久删除课程？' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '永久删除' }));
    await waitFor(() => expect(deleteCourse).toHaveBeenCalledTimes(2));
  });
});
