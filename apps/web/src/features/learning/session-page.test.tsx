// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
    openLesson: vi.fn().mockResolvedValue({ taskId: 'task_opening_01', resourceVersion: 2 }),
    getSession: vi.fn().mockResolvedValue({
      resourceVersion: 1,
      learning: { progress: 'in_progress', session: { state: 'active' } },
    }),
    sendMessage: vi.fn().mockResolvedValue({ taskId: 'task_01', resourceVersion: 3 }),
    reviseMessage: vi.fn().mockResolvedValue({ taskId: 'task_revision_01', resourceVersion: 5 }),
    retryGeneration: vi.fn().mockResolvedValue({ taskId: 'task_retry_01', resourceVersion: 5 }),
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

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe('learning SessionPage', () => {
  it('renders fixed and session-adaptive teaching emphasis beside knowledge points', async () => {
    const getSession = vi.fn().mockResolvedValue({
      resourceVersion: 4,
      learning: { progress: 'in_progress', session: { id: 'session_01', state: 'active' } },
      teachingProgress: {
        ledgerVersion: 3,
        observationStatus: 'current',
        lessonPhase: 'knowledge_point',
        comprehensiveCheck: 'pending',
        closureInquiry: 'pending',
        summaryStatus: 'pending',
        knowledgePoints: [
          {
            ref: 'knowledge:kp_1',
            title: 'Fixed key point',
            progress: 'completed',
            interactionStatus: 'completed',
            emphasis: 'key',
          },
          {
            ref: 'knowledge:kp_2',
            title: 'Adaptive difficult point',
            progress: 'learning',
            interactionStatus: 'pending',
            emphasis: 'difficult',
          },
          {
            ref: 'knowledge:kp_3',
            title: 'Combined point',
            progress: 'pending',
            interactionStatus: 'pending',
            emphasis: 'key_difficult',
          },
        ],
      },
    });

    render(<SessionPage lessonId="lesson_01" client={client({ getSession })} />);

    expect(await screen.findByText('Fixed key point')).toBeInTheDocument();
    expect(screen.getByText('重点')).toBeInTheDocument();
    expect(screen.getByText('难点')).toBeInTheDocument();
    expect(screen.getByText('重难点')).toBeInTheDocument();
  });

  it('automatically starts an AI-led opening without a user message', async () => {
    const openLesson = vi.fn().mockResolvedValue({ taskId: 'task_opening_01', resourceVersion: 2 });
    const stream = vi.fn().mockImplementation(async (_taskId, onEvent) => {
      onEvent({ type: 'message.delta', data: { markdown: '先从一个关键问题开始。' } });
    });
    const getSession = vi
      .fn()
      .mockResolvedValueOnce({
        resourceVersion: 1,
        learning: { progress: 'in_progress', session: { state: 'active' } },
        messages: [],
      })
      .mockResolvedValueOnce({
        resourceVersion: 3,
        learning: { progress: 'in_progress', session: { state: 'active' } },
        messages: [{ id: 'assistant_01', role: 'assistant', markdown: '先从一个关键问题开始。' }],
      });
    const api = client({ openLesson, stream, getSession });

    render(<SessionPage autoOpen lessonId="lesson_01" client={api} />);

    expect(await screen.findByText('先从一个关键问题开始。')).toBeInTheDocument();
    expect(openLesson).toHaveBeenCalledWith('session_01', 1);
    expect(screen.queryByText('开始提问后，AI 导师的回答会显示在这里。')).not.toBeInTheDocument();
    expect(screen.queryByText('先从一个关键问题开始。')).toBeInTheDocument();
    expect(screen.queryByText('学习中 · 渐进式教学')).not.toBeInTheDocument();
  });

  it('keeps opening preparation as transient UI and exposes an empty terminal task as retryable', async () => {
    let finishStream: (() => void) | undefined;
    const stream = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishStream = resolve;
        }),
    );
    const getSession = vi.fn().mockResolvedValue({
      resourceVersion: 2,
      learning: { progress: 'in_progress', session: { state: 'active' } },
      messages: [],
    });
    const api = client({ stream, getSession });

    render(<SessionPage autoOpen lessonId="lesson_01" client={api} />);

    expect(await screen.findByText('正在备课中，请稍等……')).toBeInTheDocument();
    await act(async () => finishStream?.());

    expect(
      await screen.findByText('AI 开场没有完成，你可以重试，或直接开始对话。'),
    ).toBeInTheDocument();
    expect(screen.queryByText('正在备课中，请稍等……')).not.toBeInTheDocument();
    expect(screen.queryByText('AI 导师正在准备本课的第一步。')).not.toBeInTheDocument();
  });

  it('offers an explicit opening retry or direct conversation fallback', async () => {
    const openLesson = vi.fn().mockRejectedValue(new Error('opening unavailable'));
    const api = client({ openLesson });

    render(<SessionPage autoOpen lessonId="lesson_01" client={api} />);

    expect(
      await screen.findByText('AI 开场没有完成，你可以重试，或直接开始对话。'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重试开场' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '直接开始对话' }));
    expect(screen.getByLabelText('学习输入')).toBeEnabled();
  });

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

  it('retries an unaccepted message in place without restoring or duplicating it', async () => {
    const sendMessage = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockImplementationOnce(() => new Promise<never>(() => undefined));
    render(<SessionPage lessonId="lesson_01" client={client({ sendMessage })} />);

    const input = await screen.findByLabelText('学习输入');
    fireEvent.change(input, { target: { value: 'Keep this question' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));

    expect(await screen.findByText('消息未发送')).toBeInTheDocument();
    expect(input).toHaveValue('');
    expect(screen.getByRole('button', { name: '重新发送' })).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'AI 回复状态' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重新发送' }));

    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(2));
    expect(screen.getAllByText('Keep this question')).toHaveLength(1);
    expect(input).toHaveValue('');
    expect(screen.getByRole('status', { name: 'AI 回复状态' })).toHaveTextContent('正在思考中');
  });

  it('cancels an active generation before resubmitting an edited user message', async () => {
    const stream = vi.fn(() => new Promise<void>(() => undefined));
    const stop = vi.fn().mockResolvedValue({
      taskId: 'task_01',
      draftArtifactRef: 'draft_task_01',
      resourceVersion: 4,
    });
    const reviseMessage = vi.fn().mockResolvedValue({
      taskId: 'task_revision_01',
      resourceVersion: 6,
      userMessageId: 'message_revised_01',
    });
    const api = client({
      sendMessage: vi.fn().mockResolvedValue({
        taskId: 'task_01',
        resourceVersion: 3,
        userMessageId: 'message_user_01',
      }),
      stream,
      stop,
      reviseMessage,
    });
    render(<SessionPage lessonId="lesson_01" client={api} />);

    const input = await screen.findByLabelText('学习输入');
    fireEvent.change(input, { target: { value: '原始问题' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    await screen.findByRole('button', { name: '停止生成' });
    fireEvent.click(await screen.findByRole('button', { name: '重新编辑' }));

    await waitFor(() =>
      expect(stop).toHaveBeenCalledWith(expect.objectContaining({ taskId: 'task_01' })),
    );
    const inlineEditor = await screen.findByRole('textbox', { name: '编辑消息' });
    expect(inlineEditor).toHaveValue('原始问题');
    expect(input).toHaveValue('');
    fireEvent.change(inlineEditor, { target: { value: '修改后的问题' } });
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));

    await waitFor(() =>
      expect(reviseMessage).toHaveBeenCalledWith({
        sessionId: 'session_01',
        messageId: 'message_user_01',
        markdown: '修改后的问题',
        resourceVersion: 4,
      }),
    );
  });

  it('enters and keeps edit mode while active generation cancellation is still pending', async () => {
    let resolveSend:
      | ((value: { taskId: string; resourceVersion: number; userMessageId: string }) => void)
      | undefined;
    const sendMessage = vi.fn(
      () =>
        new Promise<{
          taskId: string;
          resourceVersion: number;
          userMessageId: string;
        }>((resolve) => {
          resolveSend = resolve;
        }),
    );
    const stop = vi.fn().mockResolvedValue({
      taskId: 'task_01',
      draftArtifactRef: 'draft_task_01',
      resourceVersion: 4,
    });
    const stream = vi.fn(() => new Promise<void>(() => undefined));
    const api = client({
      sendMessage,
      stream,
      stop,
    });
    render(<SessionPage lessonId="lesson_01" client={api} />);

    const input = await screen.findByLabelText('学习输入');
    fireEvent.change(input, { target: { value: '原始问题' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    fireEvent.click(await screen.findByRole('button', { name: '重新编辑' }));

    expect(screen.getByRole('textbox', { name: '编辑消息' })).toHaveValue('原始问题');

    await act(async () => {
      resolveSend?.({
        taskId: 'task_01',
        resourceVersion: 3,
        userMessageId: 'message_user_01',
      });
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(stop).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: 'session_01', taskId: 'task_01' }),
      ),
    );
    expect(stream).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: '编辑消息' })).toHaveValue('原始问题');
  });

  it('retries a failed AI response without appending the user message again', async () => {
    const retryGeneration = vi
      .fn()
      .mockResolvedValue({ taskId: 'task_retry_01', resourceVersion: 5 });
    const stream = vi
      .fn()
      .mockRejectedValueOnce(new Error('generation failed'))
      .mockResolvedValueOnce(undefined);
    const api = client({
      sendMessage: vi.fn().mockResolvedValue({
        taskId: 'task_01',
        resourceVersion: 3,
        userMessageId: 'message_user_01',
      }),
      retryGeneration,
      stream,
    });
    render(<SessionPage lessonId="lesson_01" client={api} />);

    const input = await screen.findByLabelText('学习输入');
    fireEvent.change(input, { target: { value: '请重新解释' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    fireEvent.click(await screen.findByRole('button', { name: '重新生成' }));

    await waitFor(() => expect(retryGeneration).toHaveBeenCalledWith('session_01', 1));
    expect(api.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('hydrates a committed reply instead of showing retry after the stream disconnects', async () => {
    const getSession = vi
      .fn()
      .mockResolvedValueOnce({
        resourceVersion: 1,
        learning: { progress: 'in_progress', session: { state: 'active' } },
        messages: [],
      })
      .mockResolvedValueOnce({
        resourceVersion: 4,
        learning: { progress: 'in_progress', session: { state: 'active' } },
        messages: [
          { id: 'message_user_01', role: 'user', markdown: 'Explain the boundary.' },
          { id: 'message_ai_01', role: 'assistant', markdown: 'The reply was committed.' },
        ],
      });
    const api = client({
      getSession,
      sendMessage: vi.fn().mockResolvedValue({
        taskId: 'task_01',
        resourceVersion: 3,
        userMessageId: 'message_user_01',
      }),
      stream: vi.fn().mockRejectedValue(new Error('stream disconnected')),
    });
    render(<SessionPage lessonId="lesson_01" client={api} />);

    const input = await screen.findByLabelText('学习输入');
    fireEvent.change(input, { target: { value: 'Explain the boundary.' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));

    expect(await screen.findByText('The reply was committed.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重新生成' })).not.toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'AI 回复状态' })).not.toBeInTheDocument();
  });

  it('shows the regenerate icon when the generation task reports a failed terminal event', async () => {
    const retryGeneration = vi
      .fn()
      .mockResolvedValue({ taskId: 'task_retry_01', resourceVersion: 5 });
    const stream = vi
      .fn()
      .mockImplementationOnce(async (_taskId, onEvent) => {
        onEvent({ type: 'task.failed', data: { code: 'provider_failed' } });
      })
      .mockImplementationOnce(async (_taskId, onEvent) => {
        onEvent({ type: 'message.delta', data: { markdown: '重新生成后的回答' } });
        onEvent({ type: 'task.completed', data: { resultRef: 'draft_retry_01' } });
      });
    const api = client({ retryGeneration, stream });
    render(<SessionPage lessonId="lesson_01" client={api} />);

    const input = await screen.findByLabelText('学习输入');
    fireEvent.change(input, { target: { value: '请解释函数变换' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));

    const regenerate = await screen.findByRole('button', { name: '重新生成' });
    expect(regenerate).toHaveTextContent('↻');
    expect(screen.getAllByRole('article', { name: '你的消息' })).toHaveLength(1);

    fireEvent.click(regenerate);
    await waitFor(() => expect(retryGeneration).toHaveBeenCalledWith('session_01', 1));
    expect(api.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('shows the regenerate icon when a completed task contains no AI response', async () => {
    const getSession = vi
      .fn()
      .mockResolvedValueOnce({
        resourceVersion: 1,
        learning: { progress: 'in_progress', session: { state: 'active' } },
        messages: [],
      })
      .mockResolvedValueOnce({
        resourceVersion: 4,
        learning: { progress: 'in_progress', session: { state: 'active' } },
        messages: [{ id: 'message_user_01', role: 'user', markdown: '请解释函数变换' }],
      });
    const stream = vi.fn().mockImplementation(async (_taskId, onEvent) => {
      onEvent({ type: 'task.completed', data: { resultRef: 'draft_empty_01' } });
    });
    const api = client({
      getSession,
      sendMessage: vi.fn().mockResolvedValue({
        taskId: 'task_01',
        resourceVersion: 3,
        userMessageId: 'message_user_01',
      }),
      stream,
    });
    render(<SessionPage lessonId="lesson_01" client={api} />);

    const input = await screen.findByLabelText('学习输入');
    fireEvent.change(input, { target: { value: '请解释函数变换' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));

    expect(await screen.findByRole('button', { name: '重新生成' })).toHaveTextContent('↻');
    expect(screen.getAllByRole('article', { name: '你的消息' })).toHaveLength(1);
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

  it('pauses before returning to the course outline', async () => {
    const pause = vi.fn().mockResolvedValue({ resourceVersion: 2 });
    const onNavigate = vi.fn();
    const api = client({ pause });
    render(<SessionPage lessonId="lesson_01" client={api} onNavigate={onNavigate} />);

    expect(screen.queryByRole('button', { name: '暂停学习' })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: '返回课程大纲' }));

    expect(pause).toHaveBeenCalledWith('session_01', 1);
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith('/'));
  });

  it('keeps resume available for a paused session', async () => {
    const resume = vi.fn().mockResolvedValue({ resourceVersion: 2 });
    const getSession = vi.fn().mockResolvedValue({
      resourceVersion: 1,
      learning: { progress: 'in_progress', session: { state: 'paused' } },
    });
    render(<SessionPage lessonId="lesson_01" client={client({ getSession, resume })} />);

    const resumeButton = await screen.findByRole('button', { name: '继续学习' });
    const endButton = screen.getByRole('button', { name: '结束本课' });
    const returnButton = screen.getByRole('button', { name: '返回课程大纲' });
    const timerCard = screen.getByRole('heading', { name: '实际学习时长' }).closest('section');
    expect(timerCard).toContainElement(resumeButton);
    expect(timerCard).toContainElement(endButton);
    expect(timerCard).toContainElement(returnButton);

    fireEvent.click(resumeButton);

    await waitFor(() => expect(resume).toHaveBeenCalledWith('session_01', 1));
  });

  it('ends immediately and reports background stage Review generation without a snapshot hash', async () => {
    const abandon = vi.fn().mockResolvedValue({
      progress: 'abandoned',
      resourceVersion: 2,
      reviewStatus: 'generating',
    });
    render(<SessionPage lessonId="lesson_01" client={client({ abandon })} />);

    fireEvent.click(await screen.findByRole('button', { name: '结束本课' }));
    fireEvent.click(screen.getByRole('button', { name: '确认放弃课节' }));

    await waitFor(() => expect(abandon).toHaveBeenCalledWith('lesson_01', 1, '0'.repeat(64)));
    expect(
      await screen.findByText('本课已结束，阶段性 Review 正在生成中，可稍后返回课程页面查看。'),
    ).toBeInTheDocument();
  });

  it('keeps unfinished lesson nodes in a dedicated scroll region outside the actions', async () => {
    render(<SessionPage lessonId="lesson_01" client={client()} />);

    fireEvent.click(await screen.findByRole('button', { name: '结束本课' }));

    const dialog = screen.getByRole('dialog', { name: '现在结束将放弃本课' });
    const pendingList = within(dialog).getByRole('region', { name: '未完成学习路径' });
    const continueButton = within(dialog).getByRole('button', { name: '继续学习' });

    expect(pendingList).toHaveClass('lesson-end-pending-list');
    expect(pendingList).toHaveTextContent('当前知识点');
    expect(pendingList).not.toContainElement(continueButton);
  });

  it('presents a completed closure after the final summary instead of an abandonment warning', async () => {
    const getSession = vi.fn().mockResolvedValue({
      resourceVersion: 8,
      learning: { progress: 'in_progress', session: { id: 'session_01', state: 'active' } },
      closurePreparation: {
        sessionId: 'session_01',
        sourceSessionIds: ['session_01'],
        sourceMessageIds: ['message_ai_final'],
        messageRangeChecksum: 'a'.repeat(64),
        endIntent: 'complete_lesson',
      },
      teachingProgress: {
        ledgerVersion: 7,
        observationStatus: 'current',
        lessonPhase: 'ready_to_close',
        comprehensiveCheck: 'skipped',
        closureInquiry: 'confirmed_no_questions',
        summaryStatus: 'delivered',
        knowledgePoints: [],
      },
    });
    render(<SessionPage lessonId="lesson_01" client={client({ getSession })} />);

    expect(await screen.findByText('跳过检测')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: '结束本课' }));

    expect(screen.getByText('教学已闭环')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '完成本课并生成 Review' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '完成本课' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '确认放弃课节' })).not.toBeInTheDocument();
    expect(screen.queryByText('现在结束将放弃本课')).not.toBeInTheDocument();
  });

  it('immediately reports final Review generation while lesson closure continues in background', async () => {
    const closeLesson = vi.fn(() => new Promise<never>(() => undefined));
    const getSession = vi.fn().mockResolvedValue({
      resourceVersion: 8,
      learning: { progress: 'in_progress', session: { id: 'session_01', state: 'active' } },
      closurePreparation: {
        sessionId: 'session_01',
        sourceSessionIds: ['session_01'],
        sourceMessageIds: ['message_ai_final'],
        messageRangeChecksum: 'a'.repeat(64),
        endIntent: 'complete_lesson',
      },
      teachingProgress: {
        ledgerVersion: 7,
        observationStatus: 'current',
        lessonPhase: 'ready_to_close',
        comprehensiveCheck: 'completed',
        closureInquiry: 'confirmed_no_questions',
        summaryStatus: 'delivered',
        knowledgePoints: [],
      },
    });
    render(<SessionPage lessonId="lesson_01" client={client({ getSession, closeLesson })} />);

    fireEvent.click(await screen.findByRole('button', { name: '结束本课' }));
    fireEvent.click(screen.getByRole('button', { name: '完成本课' }));

    await waitFor(() => expect(closeLesson).toHaveBeenCalledTimes(1));
    expect(
      screen.getByText('本课已结束，最终 Review 正在生成中，可稍后返回课程页面查看。'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('学习输入')).toBeDisabled();
  });

  it('polls a background lesson closure and opens the completed final Review', async () => {
    const closeLesson = vi.fn().mockResolvedValue({
      transactionId: 'closure_01',
      lessonId: 'lesson_01',
      state: 'generating',
      generationTaskId: 'task_review_01',
      resourceVersion: 2,
    });
    const getClosure = vi.fn().mockResolvedValue({
      transactionId: 'closure_01',
      lessonId: 'lesson_01',
      state: 'completed',
      finalReviewId: 'review_final_01',
      review: { artifactRef: 'artifact_review_01', markdown: '# 最终 Review\n\n完成。' },
      resourceVersion: 5,
    });
    const getSession = vi.fn().mockResolvedValue({
      resourceVersion: 8,
      learning: { progress: 'in_progress', session: { id: 'session_01', state: 'active' } },
      closurePreparation: {
        sessionId: 'session_01',
        sourceSessionIds: ['session_01'],
        sourceMessageIds: ['message_ai_final'],
        messageRangeChecksum: 'a'.repeat(64),
        endIntent: 'complete_lesson',
      },
      teachingProgress: {
        ledgerVersion: 7,
        observationStatus: 'current',
        lessonPhase: 'ready_to_close',
        comprehensiveCheck: 'completed',
        closureInquiry: 'confirmed_no_questions',
        summaryStatus: 'delivered',
        knowledgePoints: [],
      },
    });
    render(
      <SessionPage lessonId="lesson_01" client={client({ getSession, closeLesson, getClosure })} />,
    );

    fireEvent.click(await screen.findByRole('button', { name: '结束本课' }));
    fireEvent.click(screen.getByRole('button', { name: '完成本课' }));

    expect(
      await screen.findByText('本课已结束，最终 Review 正在生成中，可稍后返回课程页面查看。'),
    ).toBeInTheDocument();
    expect(await screen.findByText('最终 Review', {}, { timeout: 2_500 })).toBeInTheDocument();
    expect(getClosure).toHaveBeenCalledWith('closure_01');
    expect(
      screen.queryByText('本课已结束，最终 Review 正在生成中，可稍后返回课程页面查看。'),
    ).not.toBeInTheDocument();
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
    const onNavigate = vi.fn();
    render(
      <SessionPage
        lessonId="lesson_01"
        client={client({ getSession, pause })}
        onNavigate={onNavigate}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: '返回课程大纲' }));

    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith('/'));
    expect(pause.mock.calls).toEqual([
      ['session_01', 1],
      ['session_01', 5],
    ]);
  });

  it('hydrates a completed session and its immutable final Review after refresh', async () => {
    const api = client({
      getSession: vi.fn().mockResolvedValue({
        resourceVersion: 7,
        learning: {
          progress: 'completed',
          session: { state: 'closed', finalReviewId: 'review_final_01' },
        },
        finalReview: { markdown: '# Preserved final Review' },
      }),
    });
    render(<SessionPage lessonId="lesson_01" client={api} />);

    const reviewDialog = await screen.findByRole('dialog');
    expect(reviewDialog).toHaveTextContent('Preserved final Review');
    expect(screen.getByLabelText('学习输入')).toBeDisabled();
    expect(screen.queryByRole('button', { name: '开始补充学习' })).not.toBeInTheDocument();
    fireEvent.keyDown(reviewDialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '开始补充学习' })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('projects completed lesson progress onto every visible learning-path point', async () => {
    const api = client({
      getSession: vi.fn().mockResolvedValue({
        resourceVersion: 7,
        learning: {
          progress: 'completed',
          session: { state: 'closed', finalReviewId: 'review_final_01' },
        },
        finalReview: { markdown: '# Final Review' },
      }),
    });

    render(
      <SessionPage
        client={api}
        knowledgePoints={['平均变化率', '有限求和', '极限', '微积分基本定理']}
        lessonId="lesson_01"
      />,
    );

    await waitFor(() =>
      expect(
        [...document.querySelectorAll('.learning-path li')].map((item) => item.className),
      ).toEqual(['done', 'done', 'done', 'done']),
    );
  });

  it('renders each knowledge point from the teaching ledger instead of its array position', async () => {
    const api = client({
      getSession: vi.fn().mockResolvedValue({
        resourceVersion: 4,
        learning: { progress: 'in_progress', session: { state: 'active' } },
        teachingProgress: {
          ledgerVersion: 3,
          observationStatus: 'current',
          lessonPhase: 'knowledge_point',
          activeKnowledgePointRef: 'knowledge:sum',
          comprehensiveCheck: 'pending',
          closureInquiry: 'pending',
          summaryStatus: 'pending',
          knowledgePoints: [
            {
              ref: 'knowledge:rate',
              title: '平均变化率',
              progress: 'completed',
              interactionStatus: 'completed',
              delivery: 'explained',
              verification: 'supporting',
              unresolvedQuestionCount: 0,
            },
            {
              ref: 'knowledge:sum',
              title: '有限求和',
              progress: 'learning',
              interactionStatus: 'pending',
              delivery: 'explained',
              verification: 'limiting',
              unresolvedQuestionCount: 0,
            },
            {
              ref: 'knowledge:limit',
              title: '极限',
              progress: 'skipped',
              interactionStatus: 'skipped',
              delivery: 'not_addressed',
              verification: 'not_observed',
              unresolvedQuestionCount: 0,
            },
            {
              ref: 'knowledge:derivative',
              title: '导数',
              progress: 'completed',
              interactionStatus: 'skipped',
              delivery: 'explained',
              verification: 'not_observed',
              unresolvedQuestionCount: 0,
            },
            {
              ref: 'knowledge:continuity',
              title: '连续性',
              progress: 'pending',
              interactionStatus: 'pending',
              delivery: 'not_addressed',
              verification: 'not_observed',
              unresolvedQuestionCount: 0,
            },
          ],
        },
      }),
    });

    render(<SessionPage client={api} lessonId="lesson_01" />);

    expect(await screen.findByText('连续性')).toBeInTheDocument();
    expect(
      [...document.querySelectorAll('.learning-path li')].map((item) => item.className),
    ).toEqual([
      'done',
      'done',
      'active',
      'done',
      'done',
      'pending',
      'pending',
      'pending',
      'pending',
    ]);
    expect(screen.getByText('该知识点已完成')).toBeInTheDocument();
    expect(screen.getByText('正在学习中')).toBeInTheDocument();
    expect(screen.getByText('跳过知识点')).toBeInTheDocument();
    expect(screen.getByText('跳过知识点互动')).toBeInTheDocument();
    expect(screen.getByText('待讲解')).toBeInTheDocument();
  });

  it('refreshes the visible learning path when pending teaching observation becomes current', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const getSession = vi
      .fn()
      .mockResolvedValueOnce({
        resourceVersion: 4,
        learning: { progress: 'in_progress', session: { state: 'active' } },
        teachingProgress: {
          ledgerVersion: 3,
          observationStatus: 'pending',
          lessonPhase: 'warmup',
          activeKnowledgePointRef: 'knowledge:fantasy',
          comprehensiveCheck: 'pending',
          closureInquiry: 'pending',
          summaryStatus: 'pending',
          knowledgePoints: [
            {
              ref: 'knowledge:fantasy',
              title: '玩家幻想',
              progress: 'learning',
              interactionStatus: 'pending',
              delivery: 'explained',
              verification: 'not_observed',
              unresolvedQuestionCount: 0,
            },
            {
              ref: 'knowledge:experience',
              title: '体验目标',
              progress: 'pending',
              interactionStatus: 'pending',
              delivery: 'not_addressed',
              verification: 'not_observed',
              unresolvedQuestionCount: 0,
            },
          ],
        },
      })
      .mockResolvedValue({
        resourceVersion: 5,
        learning: { progress: 'in_progress', session: { state: 'active' } },
        teachingProgress: {
          ledgerVersion: 4,
          observationStatus: 'current',
          lessonPhase: 'knowledge_point',
          activeKnowledgePointRef: 'knowledge:experience',
          comprehensiveCheck: 'pending',
          closureInquiry: 'pending',
          summaryStatus: 'pending',
          knowledgePoints: [
            {
              ref: 'knowledge:fantasy',
              title: '玩家幻想',
              progress: 'completed',
              interactionStatus: 'completed',
              delivery: 'explained',
              verification: 'supporting',
              unresolvedQuestionCount: 0,
            },
            {
              ref: 'knowledge:experience',
              title: '体验目标',
              progress: 'learning',
              interactionStatus: 'pending',
              delivery: 'not_addressed',
              verification: 'not_observed',
              unresolvedQuestionCount: 0,
            },
          ],
        },
      });

    render(<SessionPage client={client({ getSession })} lessonId="lesson_01" />);
    await waitFor(() => expect(getSession).toHaveBeenCalledTimes(1));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    await waitFor(() => expect(screen.getByText('体验目标').closest('li')).toHaveClass('active'));
    expect(screen.getByText('玩家幻想').closest('li')).toHaveClass('done');
  });

  it('refreshes preset emphasis when background teaching weights become ready', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const baseProgress = {
      ledgerVersion: 1,
      observationStatus: 'current' as const,
      lessonPhase: 'knowledge_point' as const,
      activeKnowledgePointRef: 'knowledge:composition',
      comprehensiveCheck: 'pending' as const,
      closureInquiry: 'pending' as const,
      summaryStatus: 'pending' as const,
    };
    const getSession = vi
      .fn()
      .mockResolvedValueOnce({
        resourceVersion: 2,
        learning: { progress: 'in_progress', session: { state: 'active' } },
        teachingProgress: {
          ...baseProgress,
          teachingWeightStatus: 'pending',
          knowledgePoints: [
            {
              ref: 'knowledge:composition',
              title: '复合函数',
              progress: 'learning',
              interactionStatus: 'pending',
              emphasis: 'normal',
            },
          ],
        },
      })
      .mockResolvedValue({
        resourceVersion: 2,
        learning: { progress: 'in_progress', session: { state: 'active' } },
        teachingProgress: {
          ...baseProgress,
          teachingWeightStatus: 'completed',
          knowledgePoints: [
            {
              ref: 'knowledge:composition',
              title: '复合函数',
              progress: 'learning',
              interactionStatus: 'pending',
              emphasis: 'key',
            },
          ],
        },
      });

    render(<SessionPage client={client({ getSession })} lessonId="lesson_01" />);
    await waitFor(() => expect(getSession).toHaveBeenCalledTimes(1));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(await screen.findByText('重点')).toBeInTheDocument();
    expect(getSession).toHaveBeenCalledTimes(2);
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

  it('restores the regenerate action when the persisted conversation ends with an unanswered user message', async () => {
    const getSession = vi.fn().mockResolvedValue({
      resourceVersion: 6,
      learning: { progress: 'in_progress', session: { state: 'active' } },
      messages: [
        { id: 'message_assistant_01', role: 'assistant', markdown: '上一轮完整回答。' },
        { id: 'message_user_02', role: 'user', markdown: '这一轮没有得到 AI 回答。' },
      ],
    });
    render(<SessionPage lessonId="lesson_01" client={client({ getSession })} />);

    expect(await screen.findByText('这一轮没有得到 AI 回答。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重新生成' })).toHaveTextContent('↻');
  });

  it('holds the visible learning timer during AI generation and resumes it after completion', async () => {
    let releaseStream!: () => void;
    const stream = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseStream = resolve;
        }),
    );
    const getSession = vi
      .fn()
      .mockResolvedValueOnce({
        resourceVersion: 4,
        actualSeconds: 12,
        learning: {
          progress: 'in_progress',
          session: { state: 'active', activeGenerationTaskId: 'task_running_01' },
        },
      })
      .mockResolvedValue({
        resourceVersion: 5,
        actualSeconds: 12,
        learning: { progress: 'in_progress', session: { state: 'active' } },
      });
    render(<SessionPage lessonId="lesson_01" client={client({ getSession, stream })} />);

    await waitFor(() => expect(stream).toHaveBeenCalledTimes(1));
    expect(document.body).toHaveTextContent('AI 思考中 · 计时已暂停');
    const duration = document.querySelector('.lesson-session-duration');
    expect(duration).not.toBeNull();
    const heldDuration = duration?.textContent;

    vi.useFakeTimers();
    act(() => vi.advanceTimersByTime(5_000));
    expect(duration).toHaveTextContent(heldDuration ?? '');

    await act(async () => {
      releaseStream();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(getSession).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(duration?.textContent).not.toBe(heldDuration);
    expect(document.body).not.toHaveTextContent('AI 思考中 · 计时已暂停');
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

  it('exits thinking and offers paused retry when a restored task never exposes a first frame', async () => {
    vi.useFakeTimers();
    const stream = vi.fn(() => new Promise<never>(() => undefined));
    const getSession = vi.fn().mockResolvedValue({
      resourceVersion: 4,
      learning: {
        progress: 'in_progress',
        session: { state: 'paused', activeGenerationTaskId: 'task_running_01' },
      },
      messages: [{ id: 'message_user_01', role: 'user', markdown: 'Please continue.' }],
    });
    render(<SessionPage lessonId="lesson_01" client={client({ getSession, stream })} />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByRole('status', { name: 'AI 回复状态' })).toHaveTextContent('正在思考中');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_000);
      await Promise.resolve();
    });

    expect(screen.getByRole('button', { name: '重新生成' })).toBeInTheDocument();
    expect(screen.getByLabelText('学习输入')).toBeDisabled();
    expect(screen.queryByRole('status', { name: 'AI 回复状态' })).not.toBeInTheDocument();
  });

  it('does not show thinking after a complete assistant message has already been restored', async () => {
    const stream = vi.fn(() => new Promise<never>(() => undefined));
    const getSession = vi.fn().mockResolvedValue({
      resourceVersion: 4,
      learning: {
        progress: 'in_progress',
        session: { state: 'active', activeGenerationTaskId: 'task_running_01' },
      },
      messages: [
        { id: 'message_user_01', role: 'user', markdown: '请继续讲解。' },
        { id: 'message_assistant_01', role: 'assistant', markdown: '这是已经完成的回答。' },
      ],
    });
    render(<SessionPage lessonId="lesson_01" client={client({ getSession, stream })} />);

    expect(await screen.findByText('这是已经完成的回答。')).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'AI 回复状态' })).not.toBeInTheDocument();
    expect(stream).toHaveBeenCalledWith('task_running_01', expect.any(Function));
  });
});
