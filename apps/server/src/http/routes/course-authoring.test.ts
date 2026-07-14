import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import { ApplicationProblemSchema } from '@learning-more/contracts';

import type { CourseAuthoring } from '../../modules/course-authoring/interface.js';
import {
  registerCourseAuthoringRoutes,
  type CourseAuthoringRouteOptions,
} from './course-authoring.js';

function appWith(
  execute: CourseAuthoring['execute'],
  query: CourseAuthoring['query'] = async () => {
    throw new Error('unexpected_query');
  },
  getCourse?: NonNullable<CourseAuthoring['getCourse']>,
  ingestMaterial?: NonNullable<CourseAuthoringRouteOptions['ingestMaterial']>,
) {
  const app = Fastify();
  const module: CourseAuthoring = {
    execute: async (command, context) => execute(command, context),
    query,
    ...(getCourse === undefined ? {} : { getCourse }),
  };
  void registerCourseAuthoringRoutes(app, {
    module,
    ...(ingestMaterial === undefined ? {} : { ingestMaterial }),
    nextCommandId: () => 'command_01',
    nextCorrelationId: () => 'correlation_01',
    now: () => new Date('2026-07-13T00:00:00.000Z'),
  });
  return app;
}

const headers = { 'idempotency-key': 'idem_01', 'x-csrf-token': 'csrf' };

describe('CourseAuthoring HTTP contract', () => {
  it('creates an OutlineSession with Location and ETag', async () => {
    const execute = vi.fn().mockResolvedValue({
      commandId: 'command_01',
      outcome: 'completed',
      resourceVersion: 1,
      value: { kind: 'outline-session', outlineSessionId: 'session_01', state: 'assessing' },
    });
    const response = await appWith(execute, async () => ({
      outlineSessionId: 'session_01',
      resourceVersion: 1,
      state: 'assessing',
      topic: 'probability theory',
      courseMode: 'standard',
      candidateVersionIds: [],
      completedAssessmentRounds: 1,
      canGenerateCandidate: false,
      messages: [
        {
          messageId: 'message_user_01',
          role: 'user',
          content: 'probability theory',
          status: 'complete',
          createdAt: '2026-07-13T00:00:00.000Z',
        },
        {
          messageId: 'message_assistant_01',
          role: 'assistant',
          content: 'What do you want to understand or do with probability theory?',
          status: 'complete',
          createdAt: '2026-07-13T00:00:01.000Z',
          inReplyToMessageId: 'message_user_01',
        },
      ],
    })).inject({
      method: 'POST',
      url: '/api/v1/outline-sessions',
      headers,
      payload: { topic: 'probability theory', courseMode: 'standard' },
    });

    expect(response.statusCode).toBe(201);
    expect(response.headers.location).toBe('/api/v1/outline-sessions/session_01');
    expect(response.headers.etag).toBe('"1"');
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('returns 400 for a strict body schema violation', async () => {
    const response = await appWith(vi.fn()).inject({
      method: 'POST',
      url: '/api/v1/outline-sessions',
      headers,
      payload: { topic: '', courseMode: 'standard', legacyStage: 'beginner' },
    });

    expect(response.statusCode).toBe(400);
    expect(ApplicationProblemSchema.safeParse(response.json()).success).toBe(true);
  });

  it('requires Idempotency-Key on every write', async () => {
    const response = await appWith(vi.fn()).inject({
      method: 'POST',
      url: '/api/v1/outline-sessions',
      headers: { 'x-csrf-token': 'csrf' },
      payload: { topic: 'probability theory', courseMode: 'standard' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'request_invalid' });
  });

  it('requires a quoted If-Match version on updates', async () => {
    const missing = await appWith(vi.fn()).inject({
      method: 'POST',
      url: '/api/v1/outline-sessions/session_01/candidate-generations',
      headers,
      payload: {},
    });
    const invalid = await appWith(vi.fn()).inject({
      method: 'POST',
      url: '/api/v1/outline-sessions/session_01/candidate-generations',
      headers: { ...headers, 'if-match': '1' },
      payload: {},
    });

    expect(missing.statusCode).toBe(428);
    expect(missing.json()).toMatchObject({ code: 'precondition_required' });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ code: 'request_invalid' });
  });

  it.each([
    ['version_conflict', 412],
    ['idempotency_conflict', 409],
    ['resource_not_found', 404],
  ])('maps %s to HTTP %i', async (code, status) => {
    const error = Object.assign(new Error(code), { code, currentVersion: 2 });
    const response = await appWith(vi.fn().mockRejectedValue(error)).inject({
      method: 'POST',
      url: '/api/v1/outline-sessions/session_01/candidate-generations',
      headers: { ...headers, 'if-match': '"1"' },
      payload: {},
    });

    expect(response.statusCode).toBe(status);
    expect(response.json()).toMatchObject({ code, status });
  });

  it('returns a queryable task and draft reference after recoverable generation failure', async () => {
    const response = await appWith(
      vi.fn().mockResolvedValue({
        commandId: 'command_01',
        outcome: 'accepted',
        resourceVersion: 2,
        value: {
          kind: 'generation',
          taskId: 'task_01',
          draftArtifactRef: 'draft_01',
          state: 'failed_recoverable',
        },
      }),
    ).inject({
      method: 'POST',
      url: '/api/v1/outline-sessions/session_01/candidate-generations',
      headers: { ...headers, 'if-match': '"1"' },
      payload: {},
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({ taskId: 'task_01', draftArtifactRef: 'draft_01' });
  });

  it('queries an OutlineSession through the module and returns its ETag', async () => {
    const query = vi.fn().mockResolvedValue({
      outlineSessionId: 'session_01',
      resourceVersion: 7,
      state: 'candidate-ready',
      topic: 'probability theory',
      courseMode: 'standard',
      candidateVersionIds: ['candidate_01'],
      candidateVersionId: 'candidate_01',
      candidateMarkdown: '# Candidate',
      completedAssessmentRounds: 3,
      canGenerateCandidate: true,
      messages: [],
    });
    const response = await appWith(vi.fn(), query).inject({
      method: 'GET',
      url: '/api/v1/outline-sessions/session_01',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers.etag).toBe('"7"');
    expect(query).toHaveBeenCalledWith(
      { type: 'GetOutlineSession', outlineSessionId: 'session_01' },
      expect.objectContaining({ actor: 'local-user' }),
    );
  });

  it('creates a confirmed course with a course Location', async () => {
    const execute = vi.fn().mockResolvedValue({
      commandId: 'command_01',
      outcome: 'completed',
      resourceVersion: 3,
      value: {
        kind: 'confirmation',
        courseId: 'course_01',
        outlineVersionId: 'outline_01',
      },
    });
    const response = await appWith(execute).inject({
      method: 'POST',
      url: '/api/v1/outline-sessions/session_01/confirmations',
      headers: { ...headers, 'if-match': '"2"' },
      payload: { candidateVersionId: 'candidate_01' },
    });

    expect(response.statusCode).toBe(201);
    expect(response.headers.location).toBe('/api/v1/courses/course_01');
    expect(response.json()).toEqual({
      courseId: 'course_01',
      outlineVersionId: 'outline_01',
      resourceVersion: 3,
    });
  });

  it('permanently deletes a course archive through an idempotent conditional command', async () => {
    const execute = vi.fn().mockResolvedValue({
      commandId: 'command_01',
      outcome: 'completed',
      value: {
        kind: 'course-archive-deleted',
        courseId: 'course_01',
        deletedAt: '2026-07-13T08:01:00.000Z',
        portraitRefresh: 'updating',
      },
    });
    const response = await appWith(execute).inject({
      method: 'DELETE',
      url: '/api/v1/courses/course_01',
      headers: { ...headers, 'if-match': '"4"' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      courseId: 'course_01',
      deletedAt: '2026-07-13T08:01:00.000Z',
      portraitRefresh: 'updating',
    });
    expect(execute).toHaveBeenCalledWith(
      { type: 'DeleteCourseArchive', courseId: 'course_01' },
      expect.objectContaining({ idempotencyKey: 'idem_01', expectedVersion: 4 }),
    );
  });

  it('permanently deletes an unconfirmed outline session through a conditional command', async () => {
    const execute = vi.fn().mockResolvedValue({
      commandId: 'command_01',
      outcome: 'completed',
      resourceVersion: 3,
      value: {
        kind: 'outline-session-deleted',
        outlineSessionId: 'session_01',
        deletedAt: '2026-07-13T08:01:00.000Z',
      },
    });
    const response = await appWith(execute).inject({
      method: 'DELETE',
      url: '/api/v1/outline-sessions/session_01',
      headers: { ...headers, 'if-match': '"3"' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      outlineSessionId: 'session_01',
      deletedAt: '2026-07-13T08:01:00.000Z',
    });
    expect(execute).toHaveBeenCalledWith(
      { type: 'DeleteOutlineSessionDraft', outlineSessionId: 'session_01' },
      expect.objectContaining({ idempotencyKey: 'idem_01', expectedVersion: 3 }),
    );
  });

  it('queries the formal course archive version before destructive commands', async () => {
    const getCourse = vi.fn().mockResolvedValue({
      courseId: 'course_01',
      title: 'Probability',
      status: 'active',
      courseMode: 'standard',
      outlineVersionId: 'outline_01',
      lessonIds: ['lesson_01'],
      resourceVersion: 4,
    });
    const response = await appWith(vi.fn(), undefined, getCourse).inject({
      method: 'GET',
      url: '/api/v1/courses/course_01',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers.etag).toBe('"4"');
    expect(response.json()).toMatchObject({ courseId: 'course_01', resourceVersion: 4 });
  });

  it('ingests a selected reading material with version and page-instance protection', async () => {
    const ingestMaterial = vi.fn().mockResolvedValue({
      outlineSessionId: 'session_01',
      artifactRef: 'material:session_01:hash',
      originalFileName: 'notes.txt',
      format: 'text',
      sha256: 'a'.repeat(64),
      importedAt: '2026-07-13T00:00:00.000Z',
      sections: [{ title: 'notes', level: 1 }],
      warnings: [],
      resourceVersion: 2,
    });
    const response = await appWith(vi.fn(), undefined, undefined, ingestMaterial).inject({
      method: 'POST',
      url: '/api/v1/outline-sessions/session_01/materials',
      headers: {
        ...headers,
        'x-page-instance-id': 'page_01',
        'if-match': '"2"',
      },
      payload: {
        fileName: 'notes.txt',
        mediaType: 'text/plain',
        contentBase64: Buffer.from('hello', 'utf8').toString('base64'),
      },
    });

    expect(response.statusCode, response.body).toBe(201);
    expect(ingestMaterial).toHaveBeenCalledWith(
      'session_01',
      expect.objectContaining({ fileName: 'notes.txt', mediaType: 'text/plain' }),
      expect.objectContaining({ expectedVersion: 2, pageInstanceId: 'page_01' }),
    );
  });
});
