import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import { registerReviewClosureRoutes } from './review-closure.js';

function fixture() {
  const services = {
    abandonLesson: vi.fn().mockResolvedValue({
      lessonId: 'lesson_01',
      progress: 'abandoned',
      sessionId: 'session_01',
      resourceVersion: 3,
      stageReview: { reviewId: 'review_01', taskId: 'task_01' },
    }),
    restoreLesson: vi.fn().mockResolvedValue({
      lessonId: 'lesson_01',
      progress: 'in_progress',
      sessionId: 'session_01',
      resourceVersion: 4,
    }),
    beginLessonClosure: vi.fn().mockResolvedValue({
      transactionId: 'closure_01',
      state: 'generating',
      generationTaskId: 'task_final',
      resourceVersion: 1,
    }),
    closeCourse: vi.fn().mockResolvedValue({
      courseId: 'course_01',
      state: 'generating-review',
      transactionId: 'course_01',
      resourceVersion: 2,
    }),
    getClosure: vi.fn().mockResolvedValue({
      transactionId: 'closure_01',
      state: 'generating',
      resourceVersion: 1,
    }),
    retryClosure: vi.fn().mockResolvedValue({
      transactionId: 'closure_01',
      state: 'generating',
      resourceVersion: 2,
    }),
  };
  const app = Fastify();
  void registerReviewClosureRoutes(app, {
    services,
    nextCommandId: () => 'command_01',
    nextCorrelationId: () => 'correlation_01',
    now: () => new Date('2026-07-13T00:00:00.000Z'),
  });
  return { app, services };
}

const headers = {
  'idempotency-key': 'idem_01',
  'if-match': '"2"',
  'x-page-instance-id': 'page_01',
  'x-csrf-token': 'csrf',
};

describe('ReviewClosure HTTP contract', () => {
  it('exposes abandonment, restoration, lesson closure, and course closure resources', async () => {
    const { app } = fixture();
    const abandoned = await app.inject({
      method: 'POST',
      url: '/api/v1/lessons/lesson_01/abandonments',
      headers,
      payload: { sourceSnapshotHash: 'a'.repeat(64) },
    });
    expect(abandoned.statusCode).toBe(202);
    expect(abandoned.json()).toMatchObject({ progress: 'abandoned', sessionId: 'session_01' });

    const restored = await app.inject({
      method: 'POST',
      url: '/api/v1/lessons/lesson_01/restorations',
      headers,
      payload: {},
    });
    expect(restored.statusCode).toBe(200);

    const lessonClosure = await app.inject({
      method: 'POST',
      url: '/api/v1/lessons/lesson_01/closures',
      headers,
      payload: {
        sessionId: 'session_01',
        sourceSessionIds: ['session_01'],
        sourceMessageIds: ['message_01'],
        messageRangeChecksum: 'a'.repeat(64),
        endIntent: 'finish lesson',
      },
    });
    expect(lessonClosure.statusCode).toBe(202);
    expect(lessonClosure.headers.location).toBe('/api/v1/closure-transactions/closure_01');

    const courseClosure = await app.inject({
      method: 'POST',
      url: '/api/v1/courses/course_01/closures',
      headers,
      payload: { confirmAbandoned: true },
    });
    expect(courseClosure.statusCode).toBe(202);

    const queried = await app.inject({
      method: 'GET',
      url: '/api/v1/closure-transactions/closure_01',
    });
    expect(queried.statusCode).toBe(200);
    expect(queried.headers.etag).toBe('"1"');

    const retried = await app.inject({
      method: 'POST',
      url: '/api/v1/closure-transactions/closure_01/retries',
      headers: { ...headers, 'if-match': '"1"' },
      payload: {},
    });
    expect(retried.statusCode).toBe(202);
    expect(retried.headers.etag).toBe('"2"');
  });

  it('rejects undeclared legacy closure fields', async () => {
    const { app } = fixture();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/courses/course_01/closures',
      headers,
      payload: { confirmAbandoned: true, force: true },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'request_invalid' });
  });
});
