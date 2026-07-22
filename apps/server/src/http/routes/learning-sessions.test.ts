import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import { ApplicationProblemSchema } from '@learning-more/contracts';

import type { LearningSessionModule } from '../../modules/learning-session/interface.js';
import { registerLearningSessionRoutes } from './learning-sessions.js';

function fixture(overrides: Partial<Parameters<typeof registerLearningSessionRoutes>[1]> = {}) {
  const execute = vi.fn().mockResolvedValue({
    commandId: 'command_01',
    outcome: 'completed',
    resourceVersion: 1,
    value: {
      lessonId: 'lesson_01',
      progress: 'in_progress',
      sessionId: 'session_01',
      resourceVersion: 1,
      writable: true,
      leaseToken: 'lease_01',
    },
  });
  const module: LearningSessionModule = {
    execute: async (...args) => execute(...args),
    query: async () => ({
      learning: { lessonId: 'lesson_01', progress: 'in_progress', processedCommandIds: [] },
      resourceVersion: 1,
      actualSeconds: 0,
    }),
  };
  const options = {
    module,
    teaching: {
      advanceTurn: vi.fn().mockResolvedValue({ taskId: 'task_01', resourceVersion: 2 }),
      reviseTurn: vi.fn().mockResolvedValue({ taskId: 'task_revision_01', resourceVersion: 3 }),
      retryTurn: vi.fn().mockResolvedValue({ taskId: 'task_retry_01', resourceVersion: 3 }),
      openLesson: vi.fn().mockResolvedValue({ taskId: 'task_opening_01', resourceVersion: 2 }),
      stopTurn: vi.fn().mockResolvedValue({
        taskId: 'task_01',
        draftArtifactRef: 'draft_task_01',
        assistantMessageId: 'message_assistant_01',
        completionStatus: 'interrupted' as const,
        resourceVersion: 2,
      }),
      getTeachingState: vi.fn(),
      freezeCheckpoint: vi.fn(),
    },
    resolveSession: vi.fn().mockResolvedValue({
      lessonId: 'lesson_01',
      sessionId: 'session_01',
      courseId: 'course_01',
      lessonDefinitionId: 'definition_01',
      outlineVersionId: 'outline_01',
      completedReviewRefs: [],
      currentMessageRefs: [],
    }),
    saveUserMessage: vi.fn().mockResolvedValue('artifact:user:01'),
    nextCommandId: () => 'command_01',
    nextCorrelationId: () => 'correlation_01',
    nextMessageId: () => 'message_01',
    now: () => new Date('2026-07-13T00:00:00.000Z'),
    ...overrides,
  };
  const app = Fastify();
  void registerLearningSessionRoutes(app, options);
  return { app, execute, options };
}

const headers = {
  'idempotency-key': 'idem_01',
  'x-csrf-token': 'csrf',
  'x-page-instance-id': 'page_01',
};

describe('LearningSession HTTP contract', () => {
  it('reconciles durable generation state before returning a session snapshot', async () => {
    const calls: string[] = [];
    const reconcileSession = vi.fn().mockImplementation(async () => {
      calls.push('reconcile');
    });
    const module: LearningSessionModule = {
      execute: vi.fn(),
      query: vi.fn().mockImplementation(async () => {
        calls.push('query');
        return {
          learning: {
            lessonId: 'lesson_01',
            progress: 'in_progress',
            processedCommandIds: [],
            session: {
              id: 'session_01',
              state: 'paused',
              messageIds: [],
              evidenceCheckpoint: false,
            },
          },
          resourceVersion: 4,
          actualSeconds: 10,
        };
      }),
    };
    const { app } = fixture({ module, reconcileSession });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/lesson-sessions/session_01',
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(reconcileSession).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'session_01', lessonId: 'lesson_01' }),
      'correlation_01',
    );
    expect(calls).toEqual(['reconcile', 'query']);
  });

  it('starts one original session with Location and lease token', async () => {
    const { app } = fixture();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/lessons/lesson_01/sessions',
      headers,
      payload: {},
    });
    expect(response.statusCode).toBe(201);
    expect(response.headers.location).toBe('/api/v1/lesson-sessions/session_01');
    expect(response.headers.etag).toBe('"1"');
    expect(response.json()).toMatchObject({ sessionId: 'session_01', leaseToken: 'lease_01' });
  });

  it('starts an AI-led opening generation without adding a user message', async () => {
    const { app, options } = fixture();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/lesson-sessions/session_01/opening',
      headers: { ...headers, 'if-match': '"1"' },
      payload: {},
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ taskId: 'task_opening_01', resourceVersion: 2 });
    expect(options.teaching.openLesson).toHaveBeenCalledWith(
      expect.objectContaining({ courseId: 'course_01', lessonId: 'lesson_01' }),
      expect.objectContaining({ expectedVersion: 1 }),
    );
    expect(options.saveUserMessage).not.toHaveBeenCalled();
  });

  it('persists a user message then returns its single generation task', async () => {
    const { app, options } = fixture();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/lesson-sessions/session_01/messages',
      headers: { ...headers, 'if-match': '"1"' },
      payload: { markdown: 'What is probability?' },
    });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({
      taskId: 'task_01',
      resourceVersion: 2,
      userMessageId: 'message_01',
    });
    expect(options.saveUserMessage).toHaveBeenCalledWith('message_01', 'What is probability?');
    expect(options.teaching.advanceTurn).toHaveBeenCalledWith(
      {
        courseId: 'course_01',
        lessonId: 'lesson_01',
        sessionId: 'session_01',
        userMessageId: 'message_01',
        userContentArtifactRef: 'artifact:user:01',
      },
      expect.objectContaining({ expectedVersion: 1 }),
    );
  });

  it('revises the pending user turn and retries generation without appending a duplicate message', async () => {
    const { app, options } = fixture();
    const revised = await app.inject({
      method: 'POST',
      url: '/api/v1/lesson-sessions/session_01/messages/message_original/revisions',
      headers: { ...headers, 'if-match': '"2"' },
      payload: { markdown: 'Revised question' },
    });
    expect(revised.statusCode).toBe(202);
    expect(revised.json()).toEqual({
      taskId: 'task_revision_01',
      resourceVersion: 3,
      userMessageId: 'message_01',
    });
    expect(options.teaching.reviseTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        replacedUserMessageId: 'message_original',
        userMessageId: 'message_01',
      }),
      expect.objectContaining({ expectedVersion: 2 }),
    );

    const retried = await app.inject({
      method: 'POST',
      url: '/api/v1/lesson-sessions/session_01/generation-retries',
      headers: { ...headers, 'if-match': '"3"' },
      payload: {},
    });
    expect(retried.statusCode).toBe(202);
    expect(options.teaching.retryTurn).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'session_01' }),
      expect.objectContaining({ expectedVersion: 3 }),
    );
    expect(options.teaching.advanceTurn).not.toHaveBeenCalled();
  });

  it('resumes the same original session through an explicit command endpoint', async () => {
    const { app, execute } = fixture();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/lesson-sessions/session_01/resumptions',
      headers: { ...headers, 'if-match': '"1"' },
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    expect(execute).toHaveBeenCalledWith(
      { type: 'ResumeLesson', lessonId: 'lesson_01' },
      expect.objectContaining({ expectedVersion: 1, pageInstanceId: 'page_01' }),
    );
  });

  it('returns the stopped draft and maps write lease loss without leaking internals', async () => {
    const lost = Object.assign(new Error('lost'), { code: 'write_lease_lost' });
    const { app } = fixture({
      module: {
        execute: vi.fn().mockRejectedValue(lost),
        query: vi.fn(),
      },
    });
    const rejected = await app.inject({
      method: 'POST',
      url: '/api/v1/lesson-sessions/session_01/pauses',
      headers: { ...headers, 'if-match': '"1"' },
      payload: {},
    });
    expect(rejected.statusCode).toBe(409);
    expect(ApplicationProblemSchema.safeParse(rejected.json()).success).toBe(true);
    expect(rejected.body).not.toContain('stack');

    const stoppedFixture = fixture();
    const stopped = await stoppedFixture.app.inject({
      method: 'POST',
      url: '/api/v1/lesson-sessions/session_01/generation-stops',
      headers: { ...headers, 'if-match': '"1"' },
      payload: { taskId: 'task_01' },
    });
    expect(stopped.statusCode).toBe(200);
    expect(stopped.json()).toEqual({
      taskId: 'task_01',
      draftArtifactRef: 'draft_task_01',
      resourceVersion: 2,
    });
  });

  it('hydrates committed messages and server-authoritative closure preparation', async () => {
    const module: LearningSessionModule = {
      execute: vi.fn(),
      query: vi.fn().mockResolvedValue({
        learning: {
          lessonId: 'lesson_01',
          progress: 'in_progress',
          processedCommandIds: [],
          session: {
            id: 'session_01',
            state: 'active',
            messageIds: ['message_01'],
            evidenceCheckpoint: true,
          },
        },
        resourceVersion: 3,
        actualSeconds: 120,
      }),
    };
    const { app } = fixture({
      module,
      listSessionMessages: vi.fn().mockResolvedValue([
        {
          id: 'message_01',
          role: 'user',
          createdAt: '2026-07-13T00:00:00.000Z',
          contentArtifactRef: 'artifact_01',
          completionStatus: 'complete',
        },
      ]),
      loadArtifactMarkdown: vi.fn().mockResolvedValue('Why?'),
      getTeachingProgress: vi.fn().mockResolvedValue({
        ledgerVersion: 3,
        observationStatus: 'current',
        lessonPhase: 'knowledge_point',
        activeKnowledgePointRef: 'knowledge:kp_2',
        comprehensiveCheck: 'pending',
        closureInquiry: 'pending',
        summaryStatus: 'pending',
        knowledgePoints: [
          {
            ref: 'knowledge:kp_1',
            title: '平均变化率',
            progress: 'completed',
            interactionStatus: 'completed',
            delivery: 'explained',
            verification: 'supporting',
            unresolvedQuestionCount: 0,
          },
          {
            ref: 'knowledge:kp_2',
            title: '有限求和',
            progress: 'learning',
            interactionStatus: 'pending',
            delivery: 'explained',
            verification: 'limiting',
            unresolvedQuestionCount: 1,
          },
        ],
      }),
    });
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/lesson-sessions/session_01',
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      messages: [{ id: 'message_01', markdown: 'Why?', completionStatus: 'complete' }],
      closurePreparation: {
        sessionId: 'session_01',
        sourceMessageIds: ['message_01'],
      },
      teachingProgress: {
        lessonPhase: 'knowledge_point',
        activeKnowledgePointRef: 'knowledge:kp_2',
        knowledgePoints: [
          { title: '平均变化率', progress: 'completed' },
          { title: '有限求和', progress: 'learning', unresolvedQuestionCount: 1 },
        ],
      },
    });
    expect(response.json().sessionSnapshotHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('projects an old adjacent duplicate retry as one effective user message', async () => {
    const module: LearningSessionModule = {
      execute: vi.fn(),
      query: vi.fn().mockResolvedValue({
        learning: {
          lessonId: 'lesson_01',
          progress: 'in_progress',
          processedCommandIds: [],
          session: {
            id: 'session_01',
            state: 'paused',
            messageIds: ['message_original', 'message_retry', 'message_reply'],
            evidenceCheckpoint: true,
          },
        },
        resourceVersion: 4,
        actualSeconds: 120,
      }),
    };
    const markdownByRef = new Map([
      ['artifact_original', 'same learner answer'],
      ['artifact_retry', 'same learner answer'],
      ['artifact_reply', 'assistant reply'],
    ]);
    const { app } = fixture({
      module,
      listSessionMessages: vi.fn().mockResolvedValue([
        {
          id: 'message_original',
          role: 'user',
          createdAt: '2026-07-13T00:00:00.000Z',
          contentArtifactRef: 'artifact_original',
        },
        {
          id: 'message_retry',
          role: 'user',
          createdAt: '2026-07-13T00:01:00.000Z',
          contentArtifactRef: 'artifact_retry',
        },
        {
          id: 'message_reply',
          role: 'assistant',
          createdAt: '2026-07-13T00:02:00.000Z',
          contentArtifactRef: 'artifact_reply',
          generationTaskId: 'task_reply',
        },
      ]),
      loadArtifactMarkdown: vi.fn(async (artifactRef) => markdownByRef.get(artifactRef)),
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/lesson-sessions/session_01',
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      messages: [
        { id: 'message_retry', role: 'user', markdown: 'same learner answer' },
        { id: 'message_reply', role: 'assistant', markdown: 'assistant reply' },
      ],
      closurePreparation: {
        sourceMessageIds: ['message_retry', 'message_reply'],
      },
    });
  });

  it('returns lesson-record messages with explicit roles instead of visible-text prefixes', async () => {
    const { app } = fixture({
      getLessonRecord: vi.fn().mockResolvedValue({
        lessonId: 'lesson_01',
        courseId: 'course_01',
        title: '课时',
        courseTitle: '课程',
        completedAt: '2026-07-13T00:00:00.000Z',
        actualSeconds: 120,
        progress: 'completed',
        reviewKind: 'final',
        reviewStatus: 'ready',
        original: {
          sessionId: 'session_01',
          label: '原始学习',
          messages: [
            { id: 'message_user_01', role: 'user', markdown: '导师：只是用户正文' },
            { id: 'message_ai_01', role: 'assistant', markdown: '你：只是导师正文' },
          ],
        },
        supplementary: [],
        finalReviewMarkdown: 'Review',
      }),
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/lessons/lesson_01/record',
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().original.messages).toEqual([
      { id: 'message_user_01', role: 'user', markdown: '导师：只是用户正文' },
      { id: 'message_ai_01', role: 'assistant', markdown: '你：只是导师正文' },
    ]);
  });
});
