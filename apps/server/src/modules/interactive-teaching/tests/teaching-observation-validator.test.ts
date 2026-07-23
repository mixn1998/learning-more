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
    sourceMessageIds: ['message_ai_1', 'message_user_1'],
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
    interactions: [
      {
        interactionId: 'interaction:message_ai_1',
        knowledgePointRefs: ['knowledge:kp_1'],
        promptSourceRef: 'message:message_ai_1',
        outcome: 'responded',
        responseSourceRef: 'message:message_user_1',
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
  existingEntryRefs: [],
  messages: [
    { messageId: 'message_ai_1', role: 'assistant', completionStatus: 'complete' },
    { messageId: 'message_user_1', role: 'user', completionStatus: 'complete' },
  ],
} as const;

describe('teaching observation validator', () => {
  it('accepts a source-bound observation of a complete assistant reply', () => {
    expect(validateTeachingObservation(observation(), validationContext)).toEqual(observation());
  });

  it('rejects interrupted assistant output as teaching evidence', () => {
    expect(() =>
      validateTeachingObservation(
        { ...observation(), interactions: [] },
        {
          ...validationContext,
          messages: [
            { messageId: 'message_ai_1', role: 'assistant', completionStatus: 'interrupted' },
            validationContext.messages[1],
          ],
        },
      ),
    ).toThrowError('assistant_evidence_incomplete');
  });

  it('rejects unknown knowledge point and message references atomically', () => {
    const invalid = observation();
    invalid.entries[0]!.knowledgePointRefs = ['knowledge:unknown'];
    invalid.entries[0]!.sourceRefs = ['message:unknown'];

    expect(() => validateTeachingObservation(invalid, validationContext)).toThrow();
  });

  it('allows a new observation to resolve an existing misconception entry', () => {
    const resolved = observation();
    resolved.entries[0]!.resolvesEntryRefs = ['misconception_from_previous_turn'];

    expect(
      validateTeachingObservation(resolved, {
        ...validationContext,
        existingEntryRefs: ['misconception_from_previous_turn'],
      }),
    ).toEqual(resolved);
  });

  it('still rejects a resolution reference that was never observed', () => {
    const invalid = observation();
    invalid.entries[0]!.resolvesEntryRefs = ['invented_entry'];

    expect(() => validateTeachingObservation(invalid, validationContext)).toThrowError(
      'resolved_entry_reference_unknown',
    );
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

  it('rejects key interaction prompts that do not reference a complete assistant message', () => {
    const invalid: TeachingObservation = {
      ...observation(),
      interactions: [
        {
          interactionId: 'interaction:message_user_1',
          knowledgePointRefs: ['knowledge:kp_1'],
          promptSourceRef: 'message:message_user_1',
          outcome: 'pending',
        },
      ],
    };

    expect(() => validateTeachingObservation(invalid, validationContext)).toThrowError(
      'interaction_prompt_requires_assistant',
    );
  });

  it('rejects a learner message that occurred before the key interaction prompt as its response', () => {
    expect(() =>
      validateTeachingObservation(observation(), {
        ...validationContext,
        messages: [validationContext.messages[1], validationContext.messages[0]],
      }),
    ).toThrowError('interaction_response_must_follow_prompt');
  });
});
