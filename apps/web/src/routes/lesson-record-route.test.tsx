// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LessonRecordRoute } from './lesson-record-route.js';

afterEach(cleanup);

describe('lesson record route', () => {
  it('opens the immutable Review tab from a calendar deep-link', async () => {
    const getLessonRecord = vi.fn().mockResolvedValue({
      lessonId: 'lesson_01',
      courseId: 'course_01',
      title: '真实课节标题',
      courseTitle: '真实课程标题',
      completedAt: '2026-07-13T01:02:03.000Z',
      actualSeconds: 1260,
      progress: 'completed' as const,
      reviewStatus: 'ready' as const,
      original: {
        sessionId: 'session_01',
        label: '原始学习',
        messages: [{ id: 'message_01', role: 'assistant', markdown: '原始对话' }],
      },
      supplementary: [
        {
          sessionId: 'supplementary_01',
          label: '补充学习 1',
          createdAt: '2026-07-14T01:02:03.000Z',
          messages: [{ id: 'message_02', role: 'user', markdown: '补充内容' }],
        },
      ],
      finalReviewMarkdown: '权威最终 Review',
    });
    render(
      <MemoryRouter initialEntries={['/courses/course_01/lessons/lesson_01/record?tab=review']}>
        <Routes>
          <Route
            path="courses/:courseId/lessons/:lessonId/record"
            element={<LessonRecordRoute api={{ getLessonRecord }} />}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByLabelText('权威课时 Review')).toHaveTextContent('权威最终 Review');
    expect(screen.getByRole('heading', { name: '真实课节标题' })).toBeInTheDocument();
    expect(screen.getByText(/《真实课程标题》/u)).toHaveTextContent('21 分钟');
    expect(getLessonRecord).toHaveBeenCalledWith('lesson_01');
  });

  it('opens an abandoned lesson record while its stage Review is still generating', async () => {
    const getLessonRecord = vi.fn().mockResolvedValue({
      lessonId: 'lesson_01',
      courseId: 'course_01',
      title: '未完成的课节',
      courseTitle: '真实课程标题',
      completedAt: '2026-07-13T01:02:03.000Z',
      actualSeconds: 420,
      progress: 'abandoned' as const,
      reviewStatus: 'generating' as const,
      original: {
        sessionId: 'session_01',
        label: '原始学习',
        messages: [{ id: 'message_01', role: 'assistant' as const, markdown: '已归档对话' }],
      },
      supplementary: [],
    });
    render(
      <MemoryRouter initialEntries={['/courses/course_01/lessons/lesson_01/record?tab=review']}>
        <Routes>
          <Route
            path="courses/:courseId/lessons/:lessonId/record"
            element={<LessonRecordRoute api={{ getLessonRecord }} />}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(
      await screen.findByText('阶段性 Review 正在生成中，可稍后返回课程页面查看。'),
    ).toBeInTheDocument();
    expect(screen.getByText('已结束 · 课节记录')).toBeInTheDocument();
  });
});
