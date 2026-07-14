// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  CourseAuthoringClient,
  OutlineSessionView,
} from '../../client/course-authoring-client.js';
import { AuthoringPage } from './authoring-page.js';

function client(overrides: Partial<CourseAuthoringClient> = {}): CourseAuthoringClient {
  return {
    createOutlineSession: vi.fn().mockResolvedValue({
      outlineSessionId: 'session_01',
      resourceVersion: 2,
      state: 'assessing',
      topic: '概率论',
      courseMode: 'standard',
      completedAssessmentRounds: 1,
      canGenerateCandidate: false,
      messages: [
        {
          messageId: 'message_user_01',
          role: 'user',
          content: '概率论',
          status: 'complete',
          createdAt: '2026-07-14T00:00:00.000Z',
        },
        {
          messageId: 'message_assistant_01',
          role: 'assistant',
          content: '你希望把概率论用于哪类问题？',
          status: 'complete',
          createdAt: '2026-07-14T00:00:01.000Z',
          inReplyToMessageId: 'message_user_01',
        },
      ],
    }),
    getOutlineSession: vi.fn(),
    deleteOutlineSession: vi.fn().mockResolvedValue({
      outlineSessionId: 'session_01',
      deletedAt: '2026-07-14T00:10:00.000Z',
    }),
    saveOutlineSessionDraft: vi
      .fn()
      .mockResolvedValue({ outlineSessionId: 'session_01', resourceVersion: 2 }),
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
    getCourse: vi.fn(),
    reviseOutline: vi.fn(),
    getOutlineVersion: vi.fn(),
    uploadMaterial: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  sessionStorage.clear();
});

describe('CourseAuthoring page', () => {
  it('permanently deletes the restored authoring draft after a second confirmation', async () => {
    const navigate = vi.fn();
    const deleteOutlineSession = vi.fn().mockResolvedValue({
      outlineSessionId: 'session_01',
      deletedAt: '2026-07-14T00:10:00.000Z',
    });
    const api = client({
      deleteOutlineSession,
      getOutlineSession: vi.fn().mockResolvedValue({
        outlineSessionId: 'session_01',
        resourceVersion: 3,
        savedAsDraft: true,
        state: 'candidate-ready',
        topic: '概率论',
        courseMode: 'standard',
        completedAssessmentRounds: 3,
        canGenerateCandidate: true,
        candidateVersionIds: ['candidate_01'],
        candidateVersionId: 'candidate_01',
        candidateMarkdown: '# 概率论候选大纲',
        messages: [],
        materials: [],
      }),
    });
    render(
      <AuthoringPage client={api} initialOutlineSessionId="session_01" onNavigate={navigate} />,
    );

    fireEvent.click(await screen.findByRole('button', { name: '删除草稿' }));
    expect(screen.getByRole('dialog', { name: '永久删除建档草稿？' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '确认永久删除' }));

    await waitFor(() =>
      expect(deleteOutlineSession).toHaveBeenCalledWith(
        expect.objectContaining({ outlineSessionId: 'session_01', resourceVersion: 3 }),
      ),
    );
    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('renders assessment assistant Markdown with semantic structure', async () => {
    const api = client({
      getOutlineSession: vi.fn().mockResolvedValue({
        outlineSessionId: 'session_markdown',
        resourceVersion: 2,
        state: 'assessing',
        topic: 'token',
        courseMode: 'standard',
        completedAssessmentRounds: 1,
        canGenerateCandidate: false,
        candidateVersionIds: [],
        messages: [
          {
            messageId: 'assistant_markdown',
            role: 'assistant',
            content:
              '## Clarify token\n\n**Choose the meaning closest to your goal:**\n\n- payment medium\n- model unit\n\n> We can keep adjacent ideas as a branch.',
            status: 'complete',
            createdAt: '2026-07-14T00:00:00.000Z',
          },
        ],
      }),
    });

    render(<AuthoringPage client={api} initialOutlineSessionId="session_markdown" />);

    expect(await screen.findByRole('heading', { name: 'Clarify token' })).toBeVisible();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('Choose the meaning closest to your goal:').tagName).toBe('STRONG');
    expect(document.querySelector('.ow-ai blockquote')).toHaveTextContent(
      'We can keep adjacent ideas as a branch.',
    );
    expect(document.body).not.toHaveTextContent('**Choose');
  });

  it('shows only the restore state while an existing outline session is loading', () => {
    const api = client({
      getOutlineSession: vi.fn(() => new Promise<OutlineSessionView>(() => undefined)),
    });

    render(<AuthoringPage client={api} initialOutlineSessionId="session_01" />);

    expect(screen.getByRole('status')).toHaveTextContent('正在恢复大纲建档…');
    expect(screen.queryByRole('heading', { name: '创建课程' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('学习主题')).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: '课程模式' })).not.toBeInTheDocument();
  });

  it('shows a restore failure and returns home without creating a replacement session', async () => {
    const navigate = vi.fn();
    const api = client({
      getOutlineSession: vi.fn().mockRejectedValue(new Error('outline_session_unavailable')),
    });

    render(
      <AuthoringPage client={api} initialOutlineSessionId="session_01" onNavigate={navigate} />,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('无法恢复大纲建档');
    expect(screen.queryByRole('heading', { name: '创建课程' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '返回主页' }));
    expect(api.createOutlineSession).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('shows the opening guidance, homepage message, and thinking before creation completes', () => {
    const createOutlineSession = vi.fn(() => new Promise<OutlineSessionView>(() => undefined));

    render(
      <AuthoringPage
        client={client({ createOutlineSession })}
        initialStartIntent={{ topic: '概率论', courseMode: 'standard' }}
      />,
    );

    expect(
      screen.getByText('开始前，我会先了解你的学习目标与当前基础，再与你一起形成课程大纲。'),
    ).toBeVisible();
    expect(screen.getByText('概率论')).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('正在思考中');
    expect(createOutlineSession).toHaveBeenCalledTimes(1);
  });

  it('shows a submitted assessment and thinking before the server reply is available', async () => {
    let resolveAppend!: (value: {
      outlineSessionId: string;
      state: string;
      resourceVersion: number;
    }) => void;
    const appendMessage = vi.fn(
      () =>
        new Promise<{
          outlineSessionId: string;
          state: string;
          resourceVersion: number;
        }>((resolve) => {
          resolveAppend = resolve;
        }),
    );
    const getOutlineSession = vi
      .fn()
      .mockResolvedValueOnce({
        outlineSessionId: 'session_01',
        resourceVersion: 2,
        state: 'assessing',
        topic: '概率论',
        courseMode: 'standard',
        completedAssessmentRounds: 1,
        canGenerateCandidate: false,
        candidateVersionIds: [],
        messages: [],
      })
      .mockResolvedValueOnce({
        outlineSessionId: 'session_01',
        resourceVersion: 4,
        state: 'assessing',
        topic: '概率论',
        courseMode: 'standard',
        completedAssessmentRounds: 2,
        canGenerateCandidate: false,
        candidateVersionIds: [],
        messages: [
          {
            messageId: 'user_02',
            role: 'user',
            content: '用于风险判断',
            status: 'complete',
            createdAt: '2026-07-14T00:00:02.000Z',
          },
          {
            messageId: 'assistant_02',
            role: 'assistant',
            content: '你希望先处理哪类风险？',
            status: 'complete',
            createdAt: '2026-07-14T00:00:03.000Z',
            inReplyToMessageId: 'user_02',
          },
        ],
      });
    render(
      <AuthoringPage
        client={client({ appendMessage, getOutlineSession })}
        initialOutlineSessionId="session_01"
      />,
    );

    const input = await screen.findByLabelText('补充需求');
    fireEvent.change(input, { target: { value: '用于风险判断' } });
    fireEvent.click(screen.getByRole('button', { name: '完成评估' }));

    expect(screen.getByText('用于风险判断')).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('正在思考中');
    expect(input).toHaveValue('');

    resolveAppend({ outlineSessionId: 'session_01', state: 'assessing', resourceVersion: 4 });
    expect(await screen.findByText('你希望先处理哪类风险？')).toBeVisible();
    expect(screen.queryByText('正在思考中…')).not.toBeInTheDocument();
  });

  it('renders the home-page direction as the first user message without a duplicate topic card', async () => {
    const api = client({
      getOutlineSession: vi.fn().mockResolvedValue({
        outlineSessionId: 'session_01',
        resourceVersion: 2,
        state: 'assessing',
        topic: 'token 会变成一种货币吗',
        courseMode: 'brainstorm',
        candidateVersionIds: [],
        completedAssessmentRounds: 1,
        canGenerateCandidate: false,
        messages: [
          {
            messageId: 'user_01',
            role: 'user',
            content: 'token 会变成一种货币吗',
            status: 'complete',
            createdAt: '2026-07-14T00:00:00.000Z',
          },
          {
            messageId: 'assistant_01',
            role: 'assistant',
            content: '你说的 token 更接近支付媒介、资产，还是某种使用权？',
            status: 'complete',
            createdAt: '2026-07-14T00:00:01.000Z',
            inReplyToMessageId: 'user_01',
          },
        ],
      }),
    });

    render(<AuthoringPage client={api} initialOutlineSessionId="session_01" />);

    expect(await screen.findByText('token 会变成一种货币吗')).toBeInTheDocument();
    expect(screen.queryByText('来自主页的初始主题')).not.toBeInTheDocument();
    expect(
      screen.getByText('你说的 token 更接近支付媒介、资产，还是某种使用权？'),
    ).toBeInTheDocument();
    expect(screen.getByText('已完成 1/3 轮基础评估')).toBeInTheDocument();
  });

  it('[EQ-PLAY-08] loads every mode into one full-width workbench without a second selector or topic input', async () => {
    const api = client({
      getOutlineSession: vi.fn().mockResolvedValue({
        outlineSessionId: 'session_reading',
        resourceVersion: 2,
        state: 'assessing',
        topic: '可追溯阅读',
        courseMode: 'reading_seminar',
        candidateVersionIds: [],
      }),
    });
    render(<AuthoringPage client={api} initialOutlineSessionId="session_reading" />);

    expect(await screen.findByText('正在评估课程需求')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: '课程模式' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('学习主题')).not.toBeInTheDocument();
    expect(api.createOutlineSession).not.toHaveBeenCalled();
  });

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
    expect(screen.getByText('第一课', { exact: false })).toBeInTheDocument();
  });

  it('shows candidate generation feedback before the request is accepted', async () => {
    const requestCandidateGeneration = vi.fn(() => new Promise<never>(() => undefined));
    const api = client({
      getOutlineSession: vi.fn().mockResolvedValue({
        outlineSessionId: 'session_01',
        resourceVersion: 3,
        state: 'assessment-ready',
        topic: '概率论',
        courseMode: 'standard',
        completedAssessmentRounds: 3,
        canGenerateCandidate: true,
        candidateVersionIds: [],
        messages: [],
      }),
      requestCandidateGeneration,
    });
    render(<AuthoringPage client={api} initialOutlineSessionId="session_01" />);

    fireEvent.click(await screen.findByRole('button', { name: '生成候选大纲' }));

    expect(screen.getByRole('status', { name: '候选大纲生成状态' })).toHaveTextContent(
      '正在生成候选大纲',
    );
    expect(screen.getByRole('button', { name: '正在生成…' })).toHaveAttribute('aria-busy', 'true');
    expect(requestCandidateGeneration).toHaveBeenCalledTimes(1);
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

  it('distinguishes candidate contract rejection from a Provider interruption', async () => {
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
        failureCode: 'candidate_invalid',
        resourceVersion: 2,
      }),
    });
    render(<AuthoringPage client={api} />);
    fireEvent.change(screen.getByLabelText('学习主题'), { target: { value: '概率论' } });
    fireEvent.click(screen.getByRole('button', { name: '开始创建' }));
    fireEvent.click(await screen.findByRole('button', { name: '生成候选大纲' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '候选内容已生成，但大纲结构校验未通过',
    );
    expect(screen.getByRole('status')).toHaveTextContent('课程正文草稿已保留');
    expect(document.body).not.toHaveTextContent('draft_01');
    expect(screen.getByRole('button', { name: '重试生成' })).toBeEnabled();
  });

  it('shows a distinct timeout message for a terminal generation timeout', async () => {
    const api = client({
      createOutlineSession: vi.fn().mockResolvedValue({
        outlineSessionId: 'session_01',
        resourceVersion: 1,
        state: 'ready-for-candidates',
      }),
      requestCandidateGeneration: vi.fn().mockResolvedValue({
        taskId: 'task_timeout',
        state: 'failed_recoverable',
        failureCode: 'generation_timeout',
        resourceVersion: 2,
      }),
    });
    render(<AuthoringPage client={api} />);
    fireEvent.change(screen.getByLabelText('学习主题'), { target: { value: '概率论' } });
    fireEvent.click(screen.getByRole('button', { name: '开始创建' }));
    fireEvent.click(await screen.findByRole('button', { name: '生成候选大纲' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('候选大纲生成超时');
    expect(screen.getByRole('status')).toHaveTextContent('可以直接重试');
  });

  it('shows a distinct connection interruption when the generation stream disconnects', async () => {
    const api = client({
      createOutlineSession: vi.fn().mockResolvedValue({
        outlineSessionId: 'session_01',
        resourceVersion: 1,
        state: 'ready-for-candidates',
      }),
      streamGeneration: vi.fn().mockRejectedValue(new Error('stream disconnected')),
    });
    render(<AuthoringPage client={api} />);
    fireEvent.change(screen.getByLabelText('学习主题'), { target: { value: '概率论' } });
    fireEvent.click(screen.getByRole('button', { name: '开始创建' }));
    fireEvent.click(await screen.findByRole('button', { name: '生成候选大纲' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('生成连接中断');
    expect(screen.getByRole('status')).toHaveTextContent('已收到的草稿仍然保留');
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
