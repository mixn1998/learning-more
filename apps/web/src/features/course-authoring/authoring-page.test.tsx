// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CourseAuthoringClient } from '../../client/course-authoring-client.js';
import { AuthoringPage } from './authoring-page.js';

function client(overrides: Partial<CourseAuthoringClient> = {}): CourseAuthoringClient {
  return {
    createOutlineSession: vi.fn().mockResolvedValue({
      outlineSessionId: 'session_01',
      resourceVersion: 1,
      state: 'assessing',
    }),
    getOutlineSession: vi.fn(),
    appendMessage: vi.fn().mockResolvedValue({
      kind: 'message',
      outlineSessionId: 'session_01',
      state: 'ready-for-candidates',
      resourceVersion: 2,
    }),
    requestCandidateGeneration: vi.fn().mockResolvedValue({
      taskId: 'task_01',
      state: 'running',
      resourceVersion: 3,
    }),
    streamGeneration: vi.fn().mockResolvedValue(undefined),
    confirmCandidate: vi.fn().mockResolvedValue({
      courseId: 'course_01',
      outlineVersionId: 'outline_01',
      resourceVersion: 4,
    }),
    ...overrides,
  };
}

afterEach(cleanup);

describe('CourseAuthoring page', () => {
  it('starts empty and prevents duplicate create commands independently of button state', async () => {
    let resolveCreate!: (value: {
      outlineSessionId: string;
      resourceVersion: number;
      state: string;
    }) => void;
    const create = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        resolveCreate = resolve;
      }),
    );
    const api = client({ createOutlineSession: create });
    render(<AuthoringPage client={api} />);

    expect(screen.getByRole('heading', { name: '创建课程' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('学习主题'), { target: { value: '概率论' } });
    const submit = screen.getByRole('button', { name: '开始创建' });
    fireEvent.click(submit);
    fireEvent.click(submit);

    expect(create).toHaveBeenCalledTimes(1);
    resolveCreate({ outlineSessionId: 'session_01', resourceVersion: 1, state: 'assessing' });
    expect(await screen.findByText('正在评估课程需求')).toBeInTheDocument();
  });

  it('renders append-only candidate Markdown delivered by the generation stream', async () => {
    const streamGeneration = vi.fn().mockImplementation(async (_taskId, handlers) => {
      handlers.onEvent({ type: 'message.delta', data: { markdown: '## 候选 A\n' } });
      handlers.onEvent({ type: 'message.delta', data: { markdown: '- 第一课' } });
      handlers.onEvent({
        type: 'artifact.ready',
        data: { artifactId: 'candidate_01', kind: 'outline-candidate' },
      });
      handlers.onEvent({ type: 'task.completed', data: {} });
    });
    const api = client({
      createOutlineSession: vi.fn().mockResolvedValue({
        outlineSessionId: 'session_01',
        resourceVersion: 1,
        state: 'ready-for-candidates',
      }),
      streamGeneration,
    });
    render(<AuthoringPage client={api} />);
    fireEvent.change(screen.getByLabelText('学习主题'), { target: { value: '概率论' } });
    fireEvent.click(screen.getByRole('button', { name: '开始创建' }));
    fireEvent.click(await screen.findByRole('button', { name: '生成候选大纲' }));

    expect(await screen.findByRole('heading', { name: '候选 A' })).toBeInTheDocument();
    expect(screen.getByText('第一课')).toBeInTheDocument();
  });

  it('keeps assessment text when the server reports a version conflict', async () => {
    const appendMessage = vi.fn().mockRejectedValue({
      code: 'version_conflict',
      currentVersion: 3,
    });
    const api = client({ appendMessage });
    render(<AuthoringPage client={api} />);
    fireEvent.change(screen.getByLabelText('学习主题'), { target: { value: '概率论' } });
    fireEvent.click(screen.getByRole('button', { name: '开始创建' }));

    const assessment = await screen.findByLabelText('补充需求');
    fireEvent.change(assessment, { target: { value: '希望包含贝叶斯推断' } });
    fireEvent.click(screen.getByRole('button', { name: '完成评估' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('服务端版本已更新');
    expect(assessment).toHaveValue('希望包含贝叶斯推断');
    expect(screen.getByRole('button', { name: '重新加载' })).toBeEnabled();
  });

  it('shows a recoverable draft reference when generation fails', async () => {
    const api = client({
      createOutlineSession: vi.fn().mockResolvedValue({
        outlineSessionId: 'session_01',
        resourceVersion: 1,
        state: 'ready-for-candidates',
      }),
      requestCandidateGeneration: vi.fn().mockResolvedValue({
        taskId: 'task_01',
        draftArtifactRef: 'draft_01',
        state: 'failed_recoverable',
        resourceVersion: 2,
      }),
    });
    render(<AuthoringPage client={api} />);
    fireEvent.change(screen.getByLabelText('学习主题'), { target: { value: '概率论' } });
    fireEvent.click(screen.getByRole('button', { name: '开始创建' }));
    fireEvent.click(await screen.findByRole('button', { name: '生成候选大纲' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('生成中断，草稿已保留');
    expect(screen.getByText('draft_01')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重试生成' })).toBeEnabled();
  });

  it('confirms the selected candidate and navigates to the course', async () => {
    const navigate = vi.fn();
    const api = client({
      createOutlineSession: vi.fn().mockResolvedValue({
        outlineSessionId: 'session_01',
        resourceVersion: 1,
        state: 'ready-for-candidates',
      }),
      streamGeneration: vi.fn().mockImplementation(async (_taskId, handlers) => {
        handlers.onEvent({ type: 'message.delta', data: { markdown: '## 候选课程' } });
        handlers.onEvent({
          type: 'artifact.ready',
          data: { artifactId: 'candidate_01', kind: 'outline-candidate' },
        });
        handlers.onEvent({ type: 'task.completed', data: {} });
      }),
    });
    render(<AuthoringPage client={api} onNavigate={navigate} />);
    fireEvent.change(screen.getByLabelText('学习主题'), { target: { value: '概率论' } });
    fireEvent.click(screen.getByRole('button', { name: '开始创建' }));
    fireEvent.click(await screen.findByRole('button', { name: '生成候选大纲' }));
    fireEvent.click(await screen.findByRole('button', { name: '确认此候选' }));
    fireEvent.click(screen.getByRole('button', { name: '确认创建课程' }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/courses/course_01'));
  });
});
