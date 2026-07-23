import { describe, expect, it } from 'vitest';

import {
  TeachingCheckpointSnapshotSchema,
  TeachingObservationSchema,
  TeachingStateSnapshotSchema,
} from './teaching.js';

const hash = 'a'.repeat(64);

function adjacentObservation() {
  return {
    observationId: 'observation_1',
    schemaVersion: 1,
    lessonId: 'lesson_1',
    sessionId: 'session_1',
    turnSequence: 1,
    sourceMessageIds: ['message_user_1', 'message_ai_1'],
    sourceSnapshotHash: hash,
    scope: {
      alignment: 'adjacent',
      relationRefs: ['course-topic:causal-inference', 'message:message_user_1'],
      rationale: 'The learner opened a course-related branch outside this lesson.',
    },
    entries: [
      {
        entryId: 'entry_1',
        kind: 'adjacent_exploration',
        summary: 'The learner explored a related causal-inference question.',
        knowledgePointRefs: [],
        sourceRefs: ['message:message_user_1'],
        explicitness: 'user_declared',
        resolvesEntryRefs: [],
        qualityFlags: ['direct', 'complete'],
      },
    ],
    interactions: [
      {
        interactionId: 'interaction:message_ai_1',
        knowledgePointRefs: [],
        promptSourceRef: 'message:message_ai_1',
        outcome: 'responded',
        responseSourceRef: 'message:message_user_1',
      },
    ],
    observerVersion: 'teaching-observer@1',
    observedAt: '2026-07-14T00:00:00.000Z',
    status: 'active',
  } as const;
}

function teachingState() {
  return {
    schemaVersion: 1,
    lessonId: 'lesson_1',
    sessionId: 'session_1',
    ledgerVersion: 1,
    observedThroughMessageId: 'message_ai_1',
    sourceSnapshotHash: hash,
    observationStatus: 'current',
    scopeStatus: 'aligned',
    evidenceCheckpoint: true,
    knowledgePoints: [
      {
        ref: 'knowledge:kp_1',
        delivery: 'explained',
        verification: 'not_observed',
        teachingEvidenceRefs: ['message:message_ai_1'],
        learnerEvidenceRefs: [],
        unresolvedEntryRefs: [],
      },
    ],
    openLoops: [],
    explorationBranches: [
      {
        entryId: 'entry_1',
        summary: 'The learner explored a related causal-inference question.',
        courseTopicRefs: ['course-topic:causal-inference'],
        sourceRefs: ['message:message_user_1'],
        returnAnchorRefs: ['knowledge:kp_1'],
        status: 'active',
      },
    ],
    recentLearnerSignals: [],
  } as const;
}

describe('interactive teaching contracts', () => {
  it('accepts adjacent exploration without treating it as current lesson coverage', () => {
    const observation = TeachingObservationSchema.parse(adjacentObservation());

    expect(observation.scope.alignment).toBe('adjacent');
    expect(observation.entries[0]?.knowledgePointRefs).toEqual([]);
  });

  it('requires a traceable relationship for direct, supporting, and adjacent observations', () => {
    expect(() =>
      TeachingObservationSchema.parse({
        ...adjacentObservation(),
        scope: { alignment: 'adjacent', relationRefs: [], rationale: 'related' },
      }),
    ).toThrow();
  });

  it('requires settled key interactions to reference the learner response or skip', () => {
    expect(() =>
      TeachingObservationSchema.parse({
        ...adjacentObservation(),
        interactions: [
          {
            interactionId: 'interaction:message_ai_1',
            knowledgePointRefs: [],
            promptSourceRef: 'message:message_ai_1',
            outcome: 'responded',
          },
        ],
      }),
    ).toThrow();
  });

  it('keeps teaching state evidence directional instead of declaring mastery', () => {
    expect(TeachingStateSnapshotSchema.parse(teachingState())).toEqual(teachingState());
    expect(
      TeachingStateSnapshotSchema.safeParse({ ...teachingState(), mastered: true }).success,
    ).toBe(false);
  });

  it('freezes a complete, source-bound checkpoint', () => {
    const checkpoint = TeachingCheckpointSnapshotSchema.parse({
      checkpointId: 'checkpoint_1',
      reason: 'lesson_closure',
      lessonId: 'lesson_1',
      sessionId: 'session_1',
      teachingState: teachingState(),
      observationRefs: ['observation:observation_1'],
      sourceMessageIds: ['message_user_1', 'message_ai_1'],
      sourceSnapshotHash: hash,
      observationCompleteness: 'complete',
      retentionDecision: 'preserve',
      frozenAt: '2026-07-14T00:01:00.000Z',
    });

    expect(checkpoint.teachingState.explorationBranches).toHaveLength(1);
  });
});
