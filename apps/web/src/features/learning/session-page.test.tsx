// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { LearningClient } from '../../client/learning-client.js';
import { SessionPage } from './session-page.js';

function client(overrides: Partial<LearningClient> = {}): LearningClient {
  return {
    getLessonPreview: vi.fn(),
    getLessonState: vi.fn(),
    getCourse: vi.fn(),
    deleteCourse: vi.fn(),
    start: vi.fn().mockResolvedValue({
      lessonId: 'lesson_01',
      sessionId: 'session_01',
      resourceVersion: 1,
      writable: true,
      leaseToken: 'lease_01',
    }),
    getSession: vi.fn().mockResolvedValue({
      resourceVersion: 1,
      learning: { progress: 'in_progress', session: { state: 'active' } },
    }),
    sendMessage: vi.fn().mockResolvedValue({ taskId: 'task_01', resourceVersion: 3 }),
    stream: vi.fn().mockImplementation(async (_taskId, onEvent) => {
      onEvent({ type: 'message.delta', data: { markdown: 'Assistant answer' } });
      onEvent({ type: 'task.completed', data: { resultRef: 'draft_task_01' } });
    }),
    stop: vi.fn().mockResolvedValue({
      taskId: 'task_01',
      draftArtifactRef: 'draft_task_01',
      resourceVersion: 4,
    }),
    pause: vi.fn(),
    resume: vi.fn(),
    transferLease: vi.fn(),
    abandon: vi.fn(),
    restore: vi.fn(),
    closeLesson: vi.fn(),
    getClosure: vi.fn(),
    retryClosure: vi.fn(),
    startSupplementary: vi.fn(),
    sendSupplementary: vi.fn(),
    closeCourse: vi.fn(),
    getCourseReview: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

afterEach(cleanup);

describe('learning SessionPage', () => {
  it('shows the sent message and thinking state before the request is accepted', async () => {
    const sendMessage = vi.fn(() => new Promise<never>(() => undefined));
    render(<SessionPage lessonId="lesson_01" client={client({ sendMessage })} />);

    const input = await screen.findByLabelText('学习输入');
    fireEvent.change(input, { target: { value: 'Explain conditional probability' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));

    expect(screen.getByText('Explain conditional probability')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'AI 回复状态' })).toHaveTextContent('正在思考中');
    expect(input).toHaveValue('');
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it('restores the composer and marks the local message when request acceptance fails', async () => {
    const sendMessage = vi.fn().mockRejectedValue(new Error('offline'));
    render(<SessionPage lessonId="lesson_01" client={client({ sendMessage })} />);

    const input = await screen.findByLabelText('学习输入');
    fireEvent.change(input, { target: { value: 'Keep this question' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('消息发送失败，请重试');
    expect(input).toHaveValue('Keep this question');
    expect(screen.getByText('发送失败 · 内容已恢复到输入框')).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'AI 回复状态' })).not.toBeInTheDocument();
  });

  it('streams one response for a duplicate send and keeps completed Markdown', async () => {
    const api = client({
      stream: vi.fn().mockImplementation(async (_taskId, onEvent) => {
        onEvent({
          type: 'message.delta',
          data: {
            markdown:
              '## Explanation\n\n**Key distinction**\n\n- observable evidence\n- current inference\n\n> Keep the boundary explicit.',
          },
        });
        onEvent({ type: 'task.completed', data: { resultRef: 'draft_task_01' } });
      }),
    });
    render(<SessionPage lessonId="lesson_01" client={api} />);
    const input = await screen.findByLabelText('学习输入');
    fireEvent.change(input, { target: { value: 'Explain probability' } });
    const send = screen.getByRole('button', { name: '发送' });
    fireEvent.click(send);
    fireEvent.click(send);

    expect(api.sendMessage).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('heading', { name: 'Explanation' })).toBeInTheDocument();
    expect(document.querySelectorAll('.learn-ai li')).toHaveLength(2);
    expect(screen.getByText('Key distinction').tagName).toBe('STRONG');
    expect(document.querySelector('.learn-ai blockquote')).toHaveTextContent(
      'Keep the boundary explicit.',
    );
  });

  it('shows a stopped draft reference after optimistically displaying the sent message', async () => {
    let release!: () => void;
    const stream = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const api = client({ stream });
    render(<SessionPage lessonId="lesson_01" client={api} />);
    const input = await screen.findByLabelText('学习输入');
    fireEvent.change(input, { target: { value: 'my unfinished question' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    fireEvent.click(await screen.findByRole('button', { name: '停止生成' }));
    release();

    expect(await screen.findByRole('status', { name: '生成停止状态' })).toHaveTextContent(
      '未完成内容已安全保留',
    );
    expect(document.body).not.toHaveTextContent('draft_task_01');
    expect(screen.getByText('my unfinished question')).toBeInTheDocument();
    expect(input).toHaveValue('');
  });

  it('renders a second tab read-only and explicitly transfers the lease', async () => {
    const transferLease = vi.fn().mockResolvedValue({ resourceVersion: 2, leaseToken: 'lease_02' });
    const api = client({
      start: vi.fn().mockResolvedValue({
        lessonId: 'lesson_01',
        sessionId: 'session_01',
        resourceVersion: 1,
        writable: false,
      }),
      transferLease,
    });
    render(<SessionPage lessonId="lesson_01" client={api} />);

    expect(await screen.findByLabelText('学习输入')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '接管写入权' }));
    await waitFor(() => expect(transferLease).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText('学习输入')).toBeEnabled();
  });

  it('pauses and resumes the same writable session explicitly', async () => {
    const pause = vi.fn().mockResolvedValue({ resourceVersion: 2 });
    const resume = vi.fn().mockResolvedValue({ resourceVersion: 3 });
    const api = client({ pause, resume });
    render(<SessionPage lessonId="lesson_01" client={api} />);

    fireEvent.click(await screen.findByRole('button', { name: '暂停学习' }));
    fireEvent.click(await screen.findByRole('button', { name: '继续学习' }));

    await waitFor(() => expect(resume).toHaveBeenCalledWith('session_01', 2));
    expect(pause).toHaveBeenCalledWith('session_01', 1);
  });

  it('reconciles a background version advance before retrying a session command', async () => {
    const getSession = vi
      .fn()
      .mockResolvedValueOnce({
        resourceVersion: 1,
        learning: { progress: 'in_progress', session: { state: 'active' } },
      })
      .mockResolvedValueOnce({
        resourceVersion: 5,
        learning: { progress: 'in_progress', session: { state: 'active' } },
      });
    const pause = vi
      .fn()
      .mockRejectedValueOnce({ code: 'version_conflict', currentVersion: 5 })
      .mockResolvedValueOnce({ resourceVersion: 6 });
    render(<SessionPage lessonId="lesson_01" client={client({ getSession, pause })} />);

    fireEvent.click(await screen.findByRole('button', { name: '暂停学习' }));

    await waitFor(() => expect(screen.getByLabelText('学习输入')).toBeDisabled());
    expect(pause.mock.calls).toEqual([
      ['session_01', 1],
      ['session_01', 5],
    ]);
  });

  it('hydrates a completed session and its immutable final Review after refresh', async () => {
    const startSupplementary = vi.fn().mockResolvedValue({
      id: 'supplementary_01',
      resourceVersion: 1,
    });
    const sendSupplementary = vi.fn().mockResolvedValue({
      id: 'supplementary_01',
      resourceVersion: 2,
    });
    const api = client({
      getSession: vi.fn().mockResolvedValue({
        resourceVersion: 7,
        learning: {
          progress: 'completed',
          session: { state: 'closed', finalReviewId: 'review_final_01' },
        },
        finalReview: { markdown: '# Preserved final Review' },
      }),
      startSupplementary,
      sendSupplementary,
    });
    render(<SessionPage lessonId="lesson_01" client={api} />);

    const reviewDialog = await screen.findByRole('dialog');
    expect(reviewDialog).toHaveTextContent('Preserved final Review');
    expect(screen.getByLabelText('学习输入')).toBeDisabled();
    expect(screen.queryByRole('button', { name: '开始补充学习' })).not.toBeInTheDocument();
    fireEvent.keyDown(reviewDialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '开始补充学习' }));
    const supplementaryInput = await screen.findByLabelText('补充学习输入');
    fireEvent.change(supplementaryInput, { target: { value: 'A follow-up question' } });
    fireEvent.click(screen.getByRole('button', { name: '发送补充消息' }));
    await waitFor(() =>
      expect(sendSupplementary).toHaveBeenCalledWith('supplementary_01', 'A follow-up question', 1),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('[EQ-GEN-03] restores a running generation task from the server after page refresh', async () => {
    const stream = vi.fn().mockImplementation(async (_taskId, onEvent) => {
      onEvent({ type: 'message.delta', data: { markdown: '恢复后的流式内容' } });
      onEvent({ type: 'task.completed', data: { resultRef: 'draft_recovered' } });
    });
    const getSession = vi
      .fn()
      .mockResolvedValueOnce({
        resourceVersion: 4,
        learning: {
          progress: 'in_progress',
          session: { state: 'active', activeGenerationTaskId: 'task_running_01' },
        },
      })
      .mockResolvedValue({
        resourceVersion: 5,
        learning: { progress: 'in_progress', session: { state: 'active' } },
      });
    render(<SessionPage lessonId="lesson_01" client={client({ getSession, stream })} />);

    expect(await screen.findByText('恢复后的流式内容')).toBeInTheDocument();
    expect(stream).toHaveBeenCalledWith('task_running_01', expect.any(Function));
  });

  it('shows thinking while a restored generation waits for its first stream event', async () => {
    const stream = vi.fn(() => new Promise<never>(() => undefined));
    const getSession = vi.fn().mockResolvedValue({
      resourceVersion: 4,
      learning: {
        progress: 'in_progress',
        session: { state: 'active', activeGenerationTaskId: 'task_running_01' },
      },
    });
    render(<SessionPage lessonId="lesson_01" client={client({ getSession, stream })} />);

    expect(await screen.findByRole('status', { name: 'AI 回复状态' })).toHaveTextContent(
      '正在思考中',
    );
    expect(stream).toHaveBeenCalledWith('task_running_01', expect.any(Function));
  });
});
