import { describe, expect, it } from 'vitest';

import {
  COMMAND_TYPES,
  CommandEnvelopeSchema,
  EVENT_TYPES,
  GENERATION_STREAM_EVENT_TYPES,
  GenerationStreamEventSchema,
  LearningEventEnvelopeSchema,
  QUERY_TYPES,
  QueryEnvelopeSchema,
  formatLastEventId,
  parseLastEventId,
} from './index.js';

function expectUnique(values: readonly string[]): void {
  expect(new Set(values).size).toBe(values.length);
}

describe('contract registries', () => {
  it('keeps every serialized type registry unique', () => {
    expectUnique(COMMAND_TYPES);
    expectUnique(QUERY_TYPES);
    expectUnique(EVENT_TYPES);
    expectUnique(GENERATION_STREAM_EVENT_TYPES);
  });

  it('contains the approved module boundary names', () => {
    expect(COMMAND_TYPES).toContain('ConfirmOutlineCandidate');
    expect(COMMAND_TYPES).toContain('CommitFinalReview');
    expect(COMMAND_TYPES).toContain('RequestPortraitRefresh');
    expect(QUERY_TYPES).toContain('GetCourseArchive');
    expect(QUERY_TYPES).toContain('GetProjectionHealth');
    expect(EVENT_TYPES).toContain('CourseReviewFinalized');
    expect(EVENT_TYPES).toContain('PortraitVersionCommitted');
  });
});

describe('command and query envelopes', () => {
  const context = {
    commandId: 'command-0001',
    correlationId: 'correlation-0001',
    idempotencyKey: 'idempotency-0001',
    actor: 'local-user',
    requestedAt: '2026-07-13T01:00:00.000Z',
    receivedAt: '2026-07-13T01:00:00.010Z',
  } as const;

  it('rejects undeclared command envelope fields', () => {
    const command = {
      type: 'CreateOutlineSession',
      context,
      payload: { topic: '线性代数' },
    } as const;

    expect(CommandEnvelopeSchema.parse(command)).toEqual(command);
    expect(CommandEnvelopeSchema.safeParse({ ...command, stack: 'secret' }).success).toBe(false);
  });

  it('rejects undeclared query envelope fields', () => {
    const query = {
      type: 'GetCourseArchive',
      context: {
        correlationId: 'correlation-0002',
        actor: 'local-user',
        requestedAt: '2026-07-13T01:01:00.000Z',
        receivedAt: '2026-07-13T01:01:00.010Z',
      },
      parameters: { courseId: 'course-0001' },
    } as const;

    expect(QueryEnvelopeSchema.parse(query)).toEqual(query);
    expect(QueryEnvelopeSchema.safeParse({ ...query, internalPath: 'D:\\secret' }).success).toBe(
      false,
    );
  });
});

describe('learning event envelope', () => {
  it('accepts the approved wire keys and rejects extra fields', () => {
    const event = {
      id: 'event-0001',
      schema_version: 1,
      type: 'LessonSessionStarted',
      occurred_at: '2026-07-13T01:02:00.000Z',
      recorded_at: '2026-07-13T01:02:00.010Z',
      source: 'LearningSession',
      target_refs: { lessonId: 'lesson-0001' },
      payload: { sessionId: 'lesson-session-0001' },
      idempotency_key: 'idempotency-0002',
      correlation_id: 'correlation-0003',
    } as const;

    expect(LearningEventEnvelopeSchema.parse(event)).toEqual(event);
    expect(LearningEventEnvelopeSchema.safeParse({ ...event, providerId: 'private' }).success).toBe(
      false,
    );
  });
});

describe('generation stream contract', () => {
  it('validates an append-only Markdown delta', () => {
    const delta = {
      taskId: 'generation-task-0001',
      sequence: 4,
      emittedAt: '2026-07-13T01:03:00.000Z',
      type: 'message.delta',
      data: {
        messageId: 'message-0001',
        markdown: '新增内容',
      },
    } as const;

    expect(GenerationStreamEventSchema.parse(delta)).toEqual(delta);
    expect(GenerationStreamEventSchema.safeParse({ ...delta, sequence: 0 }).success).toBe(false);
  });

  it('round-trips Last-Event-ID without ambiguity', () => {
    expect(formatLastEventId('generation-task-0001', 42)).toBe('generation-task-0001:42');
    expect(parseLastEventId('generation-task-0001:42')).toEqual({
      taskId: 'generation-task-0001',
      sequence: 42,
    });
    expect(() => parseLastEventId('generation-task-0001:0')).toThrow('Invalid Last-Event-ID');
  });
});
