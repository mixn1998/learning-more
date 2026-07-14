// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CourseAuthoringClient } from '../../client/course-authoring-client.js';
import { HomePage, selectContinueTarget } from './home-page.js';

function client(
  create = vi.fn(),
  overrides: Partial<CourseAuthoringClient> = {},
): CourseAuthoringClient {
  return {
    createOutlineSession: create,
    createOutlineAdjustmentSession: vi.fn(),
    deleteOutlineSession: vi.fn(),
    saveOutlineSessionDraft: vi.fn(),
    getOutlineSession: vi.fn(),
    appendMessage: vi.fn(),
    requestCandidateGeneration: vi.fn(),
    streamGeneration: vi.fn(),
    cancelCandidateGeneration: vi.fn(),
    confirmCandidate: vi.fn(),
    getCourse: vi.fn(),
    reviseOutline: vi.fn(),
    getOutlineVersion: vi.fn(),
    uploadMaterial: vi.fn(),
    ...overrides,
  };
}

afterEach(cleanup);

describe('home page', () => {
  it('deletes a draft directly from its draft card without resuming it', async () => {
    const navigate = vi.fn();
    const deleteOutlineSession = vi.fn().mockResolvedValue({
      outlineSessionId: 'draft_01',
      deletedAt: '2026-07-14T00:10:00.000Z',
    });
    render(
      <HomePage
        client={client(vi.fn(), { deleteOutlineSession })}
        courses={[{ courseId: 'course_01', title: '正式课程' }]}
        draftSessions={[
          {
            outlineSessionId: 'draft_01',
            topic: '要删除的草稿',
            resourceVersion: 5,
          },
        ]}
        onNavigate={navigate}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '查看草稿' }));
    const drafts = screen.getByRole('region', { name: '已保存草稿' });
    fireEvent.click(within(drafts).getByRole('button', { name: '删除草稿' }));
    expect(screen.getByRole('dialog', { name: '永久删除建档草稿？' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '确认永久删除' }));

    await waitFor(() =>
      expect(deleteOutlineSession).toHaveBeenCalledWith(
        expect.objectContaining({ outlineSessionId: 'draft_01', resourceVersion: 5 }),
      ),
    );
    expect(navigate).not.toHaveBeenCalled();
    expect(
      within(await screen.findByRole('region', { name: '已保存草稿' })).queryByText('要删除的草稿'),
    ).not.toBeInTheDocument();
  });

  it('returns from the course chooser to the home page without navigation', () => {
    const navigate = vi.fn();
    render(
      <HomePage
        client={client()}
        courses={[{ courseId: 'course_01', title: '正式课程' }]}
        onNavigate={navigate}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '继续学习' }));
    fireEvent.click(screen.getByRole('button', { name: '返回主页' }));

    expect(screen.queryByRole('dialog', { name: '选择课程' })).not.toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });

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

  it('does not show continue learning when only an unconfirmed draft exists', () => {
    render(
      <HomePage
        client={client()}
        draftSessions={[{ outlineSessionId: 'draft_01', topic: '尚未确认的草稿' }]}
        onNavigate={() => undefined}
      />,
    );

    expect(screen.queryByRole('button', { name: '继续学习' })).not.toBeInTheDocument();
  });

  it('shows the recommendation rationale, ranked alternatives, and fallback status without auto-starting', () => {
    const navigate = vi.fn();
    render(
      <HomePage
        client={client()}
        courses={[{ courseId: 'course_01', title: 'Decision course', status: 'active' }]}
        lessons={[
          {
            courseId: 'course_01',
            lessonId: 'recommended',
            title: 'Compare evidence',
            progress: 'not_started',
            recommended: true,
            recommendation: {
              versionId: 'recommendation_01',
              rank: 1,
              rationale: 'This lesson connects the completed foundation to the next decision.',
              evidenceRefs: ['review_01'],
              confidence: 0,
              expiresAt: '2026-07-15T00:00:00.000Z',
              status: 'fallback',
              warnings: ['ai_unavailable_fallback'],
            },
          },
          {
            courseId: 'course_01',
            lessonId: 'alternative',
            title: 'Test a counterexample',
            progress: 'not_started',
            recommendation: {
              versionId: 'recommendation_01',
              rank: 2,
              rationale: 'This lesson connects the completed foundation to the next decision.',
              evidenceRefs: ['review_01'],
              confidence: 0,
              expiresAt: '2026-07-15T00:00:00.000Z',
              status: 'fallback',
              warnings: ['ai_unavailable_fallback'],
            },
          },
        ]}
        onNavigate={navigate}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '继续学习' }));
    const course = screen.getByRole('button', { name: /Decision course/ });
    expect(course).toHaveTextContent(
      'This lesson connects the completed foundation to the next decision.',
    );
    expect(course).toHaveTextContent('备选：Test a counterexample');
    expect(course).toHaveTextContent('临时推荐 · AI 恢复后会重新评估');
    expect(navigate).not.toHaveBeenCalled();
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

  it('opens saved drafts separately and keeps them out of continue learning', () => {
    render(
      <HomePage
        client={client()}
        courses={[{ courseId: 'course_01', title: '正式课程' }]}
        draftSessions={[{ outlineSessionId: 'draft_01', topic: '已保存草稿', resourceVersion: 3 }]}
        onNavigate={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '查看草稿' }));
    expect(screen.getByRole('region', { name: '已保存草稿' })).toHaveTextContent('已保存草稿');
    expect(screen.queryByRole('region', { name: '正式课程' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '返回主页' }));
    fireEvent.click(screen.getByRole('button', { name: '继续学习' }));
    expect(screen.getByRole('region', { name: '正式课程' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '已保存草稿' })).not.toBeInTheDocument();
  });

  it('[EQ-HOME-03] keeps saved drafts separate from formal courses', () => {
    render(
      <HomePage
        client={client()}
        onNavigate={() => undefined}
        draftSessions={[{ outlineSessionId: 'draft_01', topic: '草稿主题' }]}
        courses={[{ courseId: 'course_01', title: '正式主题' }]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '查看草稿' }));
    expect(screen.getByRole('region', { name: '已保存草稿' })).toHaveTextContent('草稿主题');
    fireEvent.click(screen.getByRole('button', { name: '返回主页' }));
    fireEvent.click(screen.getByRole('button', { name: '继续学习' }));
    expect(screen.getByRole('region', { name: '正式课程' })).toHaveTextContent('正式主题');
  });

  it('shows action-oriented course cards with real progress and recent learning', () => {
    const navigate = vi.fn();
    render(
      <HomePage
        client={client()}
        courses={[{ courseId: 'course_01', title: '正式课程示例', status: 'active' }]}
        draftSessions={[
          {
            outlineSessionId: 'draft_01',
            topic: '未确认大纲示例',
            state: 'candidate-ready',
          },
        ]}
        lessons={[
          {
            courseId: 'course_01',
            lessonId: 'completed_01',
            title: '已完成课节一',
            progress: 'completed',
            lastActivityAt: '2026-07-11T08:00:00.000Z',
          },
          {
            courseId: 'course_01',
            lessonId: 'completed_02',
            title: '已完成课节二',
            progress: 'completed',
            lastActivityAt: '2026-07-12T09:30:00.000Z',
          },
          {
            courseId: 'course_01',
            lessonId: 'active',
            title: '正在学习的课节',
            progress: 'in_progress',
            sessionId: 'session_01',
            lastActivityAt: '2026-07-12T12:30:00.000Z',
          },
          {
            courseId: 'course_01',
            lessonId: 'recommended',
            title: '推荐课节',
            progress: 'not_started',
            recommended: true,
          },
          {
            courseId: 'course_01',
            lessonId: 'later',
            title: '后续课节',
            progress: 'not_started',
          },
        ]}
        onNavigate={navigate}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '查看草稿' }));
    const draftCard = screen.getByRole('button', { name: /未确认大纲示例/ });
    expect(draftCard).toHaveTextContent('继续完成大纲建档');
    expect(within(draftCard).queryByRole('progressbar')).not.toBeInTheDocument();

    fireEvent.click(draftCard);
    expect(navigate).toHaveBeenCalledWith('/courses/new?outlineSessionId=draft_01');
    navigate.mockClear();

    fireEvent.click(screen.getByRole('button', { name: '返回主页' }));
    fireEvent.click(screen.getByRole('button', { name: '继续学习' }));
    const formalCard = screen.getByRole('button', { name: /正式课程示例/ });
    expect(formalCard).toHaveTextContent('已完成 2/5 节');
    expect(formalCard).toHaveTextContent('最近学习 07/12 20:30');
    expect(formalCard).toHaveTextContent('下一课：正在学习的课节');
    expect(within(formalCard).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '40');

    fireEvent.click(formalCard);
    expect(navigate).toHaveBeenCalledWith('/courses/course_01/lessons/active');
  });

  it('[EQ-PLAY-03] hands off one start intent immediately without waiting for session creation', () => {
    const create = vi.fn(() => new Promise<never>(() => undefined));
    const navigate = vi.fn();
    const startAuthoring = vi.fn();
    render(
      <HomePage client={client(create)} onNavigate={navigate} onStartAuthoring={startAuthoring} />,
    );
    fireEvent.click(screen.getByRole('radio', { name: /论证交锋/ }));
    expect(create).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('学习主题'), { target: { value: '证据推理' } });
    fireEvent.click(screen.getByRole('button', { name: /开始交锋/ }));
    expect(startAuthoring).toHaveBeenCalledTimes(1);
    expect(startAuthoring).toHaveBeenCalledWith(
      expect.objectContaining({ topic: '证据推理', courseMode: 'argument_clash' }),
    );
    expect(create).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});
