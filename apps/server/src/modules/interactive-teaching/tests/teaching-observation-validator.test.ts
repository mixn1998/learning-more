import type { TeachingObservation } from '@learning-more/contracts';
import { describe, expect, it } from 'vitest';

import { validateTeachingObservation } from '../implementation/teaching-observation-validator.js';

function observation(): TeachingObservation {
  return {
    observationId: 'observation_1',
    schemaVersion: 1,
    lessonId: 'lesson_1',
    sessionId: 'session_1',
    turnSequence: 1,
    sourceMessageIds: ['message_user_1', 'message_ai_1'],
    sourceSnapshotHash: 'a'.repeat(64),
    scope: {
      alignment: 'direct',
      relationRefs: ['knowledge:kp_1'],
      rationale: 'Current lesson knowledge.',
    },
    entries: [
      {
        entryId: 'entry_1',
        kind: 'teaching_delivery',
        summary: 'The assistant explained the current concept.',
        knowledgePointRefs: ['knowledge:kp_1'],
        sourceRefs: ['message:message_ai_1'],
        resolvesEntryRefs: [],
        qualityFlags: ['direct', 'complete'],
      },
    ],
    observerVersion: 'teaching-observer@1',
    observedAt: '2026-07-14T00:00:00.000Z',
    status: 'active',
  };
}

const validationContext = {
  lessonId: 'lesson_1',
  sessionId: 'session_1',
  sourceSnapshotHash: 'a'.repeat(64),
  knowledgePointRefs: ['knowledge:kp_1'],
  courseRelationRefs: ['course-topic:probability'],
  openEntryRefs: [],
  messages: [
    { messageId: 'message_user_1', role: 'user', completionStatus: 'complete' },
    { messageId: 'message_ai_1', role: 'assistant', completionStatus: 'complete' },
  ],
} as const;

describe('teaching observation validator', () => {
  it('accepts a source-bound observation of a complete assistant reply', () => {
    expect(validateTeachingObservation(observation(), validationContext)).toEqual(observation());
  });

  it('rejects interrupted assistant output as teaching evidence', () => {
    expect(() =>
      validateTeachingObservation(observation(), {
        ...validationContext,
        messages: [
          validationContext.messages[0],
          { messageId: 'message_ai_1', role: 'assistant', completionStatus: 'interrupted' },
        ],
      }),
    ).toThrowError('assistant_evidence_incomplete');
  });

  it('rejects unknown knowledge point and message references atomically', () => {
    const invalid = observation();
    invalid.entries[0]!.knowledgePointRefs = ['knowledge:unknown'];
    invalid.entries[0]!.sourceRefs = ['message:unknown'];

    expect(() => validateTeachingObservation(invalid, validationContext)).toThrow();
  });

  it('rejects an assistant teaching prompt misclassified as an open learner question', () => {
    const invalid: TeachingObservation = {
      ...observation(),
      entries: [
        {
          entryId: 'entry_open_loop',
          kind: 'open_loop',
          summary: 'The assistant asked the learner a teaching question.',
          knowledgePointRefs: ['knowledge:kp_1'],
          sourceRefs: ['message:message_ai_1'],
          resolvesEntryRefs: [],
          qualityFlags: ['direct', 'complete'],
        },
      ],
    };

    expect(() => validateTeachingObservation(invalid, validationContext)).toThrowError(
      'open_loop_requires_user_source',
    );
  });
});
