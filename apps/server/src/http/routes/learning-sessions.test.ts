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
    generation: {
      request: vi.fn().mockResolvedValue({ taskId: 'task_01', resourceVersion: 2 }),
      stop: vi.fn().mockResolvedValue({
        taskId: 'task_01',
        draftArtifactRef: 'draft_task_01',
        resourceVersion: 2,
      }),
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

  it('persists a user message then returns its single generation task', async () => {
    const { app, options } = fixture();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/lesson-sessions/session_01/messages',
      headers: { ...headers, 'if-match': '"1"' },
      payload: { markdown: 'What is probability?', establishesEvidence: true },
    });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ taskId: 'task_01', resourceVersion: 2 });
    expect(options.saveUserMessage).toHaveBeenCalledWith('message_01', 'What is probability?');
    expect(options.generation.request).toHaveBeenCalledTimes(1);
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
});
