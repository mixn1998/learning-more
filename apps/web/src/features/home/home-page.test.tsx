// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CourseAuthoringClient } from '../../client/course-authoring-client.js';
import { HomePage, selectContinueTarget } from './home-page.js';

function client(create = vi.fn()): CourseAuthoringClient {
  return {
    createOutlineSession: create,
    getOutlineSession: vi.fn(),
    appendMessage: vi.fn(),
    requestCandidateGeneration: vi.fn(),
    streamGeneration: vi.fn(),
    confirmCandidate: vi.fn(),
  };
}

afterEach(cleanup);

describe('home page', () => {
  it('shows the permanent deletion result after returning from a course archive', () => {
    render(
      <HomePage client={client()} onNavigate={() => undefined} notice="课程及关联记录已永久删除" />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('课程及关联记录已永久删除');
  });

  it('[EQ-HOME-01] shows course creation in the empty state without a fake continue action', () => {
    render(<HomePage client={client()} onNavigate={() => undefined} />);
    expect(screen.getByRole('region', { name: '创建课程' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '继续学习' })).not.toBeInTheDocument();
  });

  it('[EQ-HOME-02] resumes an active session, otherwise recommends an unstarted lesson and skips abandoned', () => {
    const abandoned = {
      courseId: 'course_01',
      lessonId: 'abandoned',
      progress: 'abandoned' as const,
    };
    const recommended = {
      courseId: 'course_01',
      lessonId: 'recommended',
      progress: 'not_started' as const,
      recommended: true,
    };
    const active = {
      courseId: 'course_01',
      lessonId: 'active',
      progress: 'in_progress' as const,
      sessionId: 'session_01',
    };
    expect(selectContinueTarget([abandoned, recommended, active])).toBe(active);
    expect(selectContinueTarget([abandoned, recommended])).toBe(recommended);
  });

  it('[EQ-HOME-03] keeps unconfirmed outline sessions separate from formal courses', () => {
    render(
      <HomePage
        client={client()}
        onNavigate={() => undefined}
        draftSessions={[{ outlineSessionId: 'draft_01', topic: '草稿主题' }]}
        courses={[{ courseId: 'course_01', title: '正式主题' }]}
      />,
    );
    expect(screen.getByRole('region', { name: '未确认大纲会话' })).toHaveTextContent('草稿主题');
    expect(screen.getByRole('region', { name: '正式课程' })).toHaveTextContent('正式主题');
  });

  it('[EQ-PLAY-03] changes mode without creating state and creates one OutlineSession only on submit', async () => {
    const create = vi.fn().mockResolvedValue({
      outlineSessionId: 'outline_01',
      resourceVersion: 1,
      state: 'assessing',
    });
    const navigate = vi.fn();
    render(<HomePage client={client(create)} onNavigate={navigate} />);
    fireEvent.click(screen.getByRole('radio', { name: /观点碰撞/ }));
    expect(create).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('学习主题'), { target: { value: '证据推理' } });
    fireEvent.click(screen.getByRole('button', { name: '开始创建' }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ topic: '证据推理', courseMode: 'argument_clash' }),
    );
    expect(navigate).toHaveBeenCalledWith('/courses/new?outlineSessionId=outline_01');
  });
});
