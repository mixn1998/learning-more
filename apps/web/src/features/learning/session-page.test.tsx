// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { LearningClient } from '../../client/learning-client.js';
import { SessionPage } from './session-page.js';

function client(overrides: Partial<LearningClient> = {}): LearningClient {
  return {
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
    startSupplementary: vi.fn(),
    sendSupplementary: vi.fn(),
    closeCourse: vi.fn(),
    getCourseReview: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

afterEach(cleanup);

describe('learning SessionPage', () => {
  it('streams one response for a duplicate send and keeps completed Markdown', async () => {
    const api = client();
    render(<SessionPage lessonId="lesson_01" client={api} />);
    const input = await screen.findByLabelText('学习输入');
    fireEvent.change(input, { target: { value: 'Explain probability' } });
    const send = screen.getByRole('button', { name: '发送' });
    fireEvent.click(send);
    fireEvent.click(send);

    expect(api.sendMessage).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Assistant answer')).toBeInTheDocument();
  });

  it('shows a stopped draft reference and preserves the editable input', async () => {
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

    expect(await screen.findByText('draft_task_01')).toBeInTheDocument();
    expect(input).toHaveValue('my unfinished question');
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

    expect(await screen.findByRole('dialog')).toHaveTextContent('Preserved final Review');
    expect(screen.getByLabelText('学习输入')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '开始补充学习' }));
    const supplementaryInput = await screen.findByLabelText('补充学习输入');
    fireEvent.change(supplementaryInput, { target: { value: 'A follow-up question' } });
    fireEvent.click(screen.getByRole('button', { name: '发送补充消息' }));
    await waitFor(() =>
      expect(sendSupplementary).toHaveBeenCalledWith('supplementary_01', 'A follow-up question', 1),
    );
    expect(screen.getByRole('dialog')).toHaveTextContent('Preserved final Review');
  });
});
