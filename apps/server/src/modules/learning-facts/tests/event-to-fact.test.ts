import { describe, expect, it } from 'vitest';

import type { LearningEventEnvelope } from '@learning-more/contracts';

import { eventToFacts } from '../implementation/event-to-fact.js';

function event(
  type: LearningEventEnvelope['type'],
  payload: Record<string, unknown> = {},
): LearningEventEnvelope {
  return {
    id: `event_${type}`,
    schema_version: 1,
    type,
    occurred_at: '2026-07-13T01:02:03.000Z',
    recorded_at: '2026-07-13T01:02:04.000Z',
    source: 'test',
    target_refs: { courseId: 'course_01', lessonId: 'lesson_01' },
    payload,
    idempotency_key: `idem_${type}`,
    correlation_id: 'correlation_01',
  };
}

describe('eventToFacts', () => {
  it.each([
    ['LessonSessionStarted', 'LessonStartedFact', ['lesson.started_at', 'lesson.session_id']],
    ['LessonSessionPaused', 'LessonPausedFact', ['lesson.paused_at', 'lesson.session_id']],
    [
      'LessonAbandoned',
      'LessonAbandonedFact',
      ['lesson.abandoned_at', 'lesson.evidence_checkpoint'],
    ],
    ['LessonRestored', 'LessonRestoredFact', ['lesson.restored_at', 'lesson.session_id']],
    [
      'LessonSessionCompleted',
      'LessonCompletedFact',
      ['lesson.completed_at', 'completion.actual_seconds'],
    ],
    ['CourseCreated', 'CourseCreatedFact', ['course.created_at', 'course.id']],
    ['CourseClosed', 'CourseClosedFact', ['course.closed_at', 'course.status']],
    ['ReviewFinalized', 'ReviewFinalizedFact', ['review.generated_at', 'review.id']],
    ['SchedulePlanned', 'ScheduleConfirmedFact', ['schedule.assignment_id', 'schedule.status']],
  ] as const)('maps %s to %s with explicit dataKeys', (eventType, factType, dataKeys) => {
    const facts = eventToFacts(
      event(eventType, {
        sessionId: 'session_01',
        reviewId: 'review_01',
        scheduleItemId: 'schedule_01',
        evidenceCheckpoint: true,
        actualSeconds: 120,
      }),
    );
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({
      factType,
      sourceEventId: `event_${eventType}`,
      subjectRefs: { courseId: 'course_01', lessonId: 'lesson_01' },
      occurredAt: '2026-07-13T01:02:03.000Z',
      recordedAt: '2026-07-13T01:02:04.000Z',
      schemaVersion: 1,
      payload: expect.any(Object),
    });
    expect(facts[0]!.dataKeys).toEqual(expect.arrayContaining([...dataKeys]));
  });

  it('maps stage Review, generation delta, UI telemetry, and unknown events to no facts', () => {
    expect(eventToFacts(event('ReviewCreated', { reviewType: 'stage' }))).toEqual([]);
    for (const ignoredType of ['GenerationDeltaReceived', 'UiPageViewed', 'FutureUnknownEvent']) {
      expect(
        eventToFacts({
          ...event('CourseCreated'),
          id: `event_${ignoredType}`,
          type: ignoredType,
        } as unknown as LearningEventEnvelope),
      ).toEqual([]);
    }
  });

  it('creates a stable fact id when the same committed event is replayed', () => {
    const source = event('LessonSessionCompleted', { actualSeconds: 120 });
    expect(eventToFacts(source)).toEqual(eventToFacts(source));
  });
});
