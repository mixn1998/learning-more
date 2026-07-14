import type { TeachingObservation } from '@learning-more/contracts';
import { describe, expect, it } from 'vitest';

import {
  createTeachingState,
  reduceTeachingState,
} from '../implementation/teaching-state-reducer.js';

const directHash = 'a'.repeat(64);

function observation(
  patch: Partial<TeachingObservation> & Pick<TeachingObservation, 'observationId' | 'entries'>,
): TeachingObservation {
  return {
    schemaVersion: 1,
    lessonId: 'lesson_1',
    sessionId: 'session_1',
    turnSequence: 1,
    sourceMessageIds: ['message_user_1', 'message_ai_1'],
    sourceSnapshotHash: directHash,
    scope: {
      alignment: 'direct',
      relationRefs: ['knowledge:kp_1'],
      rationale: 'The exchange directly concerns the current knowledge point.',
    },
    observerVersion: 'teaching-observer@1',
    observedAt: '2026-07-14T00:00:00.000Z',
    status: 'active',
    ...patch,
  };
}

describe('teaching state reducer', () => {
  it('records validated delivery without claiming learner mastery', () => {
    const initial = createTeachingState({
      lessonId: 'lesson_1',
      sessionId: 'session_1',
      knowledgePointRefs: ['knowledge:kp_1'],
    });
    const next = reduceTeachingState(
      initial,
      observation({
        observationId: 'observation_delivery',
        entries: [
          {
            entryId: 'entry_delivery',
            kind: 'teaching_delivery',
            summary:
              'The assistant explained why conditional probability changes the sample space.',
            knowledgePointRefs: ['knowledge:kp_1'],
            sourceRefs: ['message:message_ai_1'],
            resolvesEntryRefs: [],
            qualityFlags: ['direct', 'complete'],
          },
        ],
      }),
    );

    expect(next.knowledgePoints[0]).toMatchObject({
      delivery: 'explained',
      verification: 'not_observed',
      teachingEvidenceRefs: ['message:message_ai_1'],
      learnerEvidenceRefs: [],
    });
    expect(next.evidenceCheckpoint).toBe(true);
  });

  it('[EQ-LESSON-09] establishes checkpoints only from complete, relevant semantic evidence', () => {
    const initial = createTeachingState({
      lessonId: 'lesson_1',
      sessionId: 'session_1',
      knowledgePointRefs: ['knowledge:kp_1'],
    });
    const incomplete = reduceTeachingState(
      initial,
      observation({
        observationId: 'observation_incomplete',
        entries: [
          {
            entryId: 'entry_incomplete',
            kind: 'teaching_delivery',
            summary: 'The reply was interrupted before the explanation was complete.',
            knowledgePointRefs: ['knowledge:kp_1'],
            sourceRefs: ['message:message_ai_1'],
            resolvesEntryRefs: [],
            qualityFlags: ['direct'],
          },
        ],
      }),
    );
    const unclear = reduceTeachingState(
      incomplete,
      observation({
        observationId: 'observation_unclear',
        turnSequence: 2,
        sourceSnapshotHash: 'b'.repeat(64),
        scope: {
          alignment: 'unclear',
          relationRefs: [],
          rationale: 'A navigation acknowledgement has no reliable knowledge relation.',
        },
        entries: [
          {
            entryId: 'entry_acknowledgement',
            kind: 'learner_intent',
            summary: 'The learner acknowledged the navigation prompt.',
            knowledgePointRefs: [],
            sourceRefs: ['message:message_user_1'],
            resolvesEntryRefs: [],
            qualityFlags: ['complete'],
          },
        ],
      }),
    );
    const openLoopOnly = reduceTeachingState(
      unclear,
      observation({
        observationId: 'observation_open_loop',
        turnSequence: 3,
        sourceSnapshotHash: 'c'.repeat(64),
        entries: [
          {
            entryId: 'entry_open_loop',
            kind: 'open_loop',
            summary: 'A question has been asked but not answered yet.',
            knowledgePointRefs: ['knowledge:kp_1'],
            sourceRefs: ['message:message_user_1'],
            resolvesEntryRefs: [],
            qualityFlags: ['direct', 'complete'],
          },
        ],
      }),
    );

    expect(incomplete.evidenceCheckpoint).toBe(false);
    expect(unclear.evidenceCheckpoint).toBe(false);
    expect(openLoopOnly.evidenceCheckpoint).toBe(false);

    const substantiveQuestion = reduceTeachingState(
      openLoopOnly,
      observation({
        observationId: 'observation_question',
        turnSequence: 4,
        sourceSnapshotHash: 'd'.repeat(64),
        entries: [
          {
            entryId: 'entry_question',
            kind: 'learner_question',
            summary: 'The learner asked how conditioning changes the applicable sample space.',
            knowledgePointRefs: ['knowledge:kp_1'],
            sourceRefs: ['message:message_user_1'],
            resolvesEntryRefs: [],
            qualityFlags: ['direct', 'complete'],
          },
        ],
      }),
    );

    expect(substantiveQuestion.evidenceCheckpoint).toBe(true);
    expect(substantiveQuestion.knowledgePoints[0]?.verification).toBe('not_observed');
  });

  it('preserves supporting and limiting learner evidence as mixed', () => {
    const initial = createTeachingState({
      lessonId: 'lesson_1',
      sessionId: 'session_1',
      knowledgePointRefs: ['knowledge:kp_1'],
    });
    const supporting = reduceTeachingState(
      initial,
      observation({
        observationId: 'observation_supporting',
        entries: [
          {
            entryId: 'entry_supporting',
            kind: 'learner_demonstration',
            summary: 'The learner correctly distinguished conditional and joint probability.',
            knowledgePointRefs: ['knowledge:kp_1'],
            sourceRefs: ['message:message_user_1'],
            assessment: 'supports',
            explicitness: 'ai_observed',
            resolvesEntryRefs: [],
            qualityFlags: ['direct', 'complete'],
          },
        ],
      }),
    );
    const mixed = reduceTeachingState(
      supporting,
      observation({
        observationId: 'observation_limiting',
        turnSequence: 2,
        sourceSnapshotHash: 'b'.repeat(64),
        sourceMessageIds: ['message_user_2'],
        entries: [
          {
            entryId: 'entry_limiting',
            kind: 'learner_misconception',
            summary:
              'The learner then treated the two quantities as interchangeable in a new case.',
            knowledgePointRefs: ['knowledge:kp_1'],
            sourceRefs: ['message:message_user_2'],
            assessment: 'limits',
            explicitness: 'ai_observed',
            resolvesEntryRefs: [],
            qualityFlags: ['direct', 'complete'],
          },
        ],
      }),
    );

    expect(mixed.knowledgePoints[0]?.verification).toBe('mixed');
    expect(mixed.knowledgePoints[0]?.learnerEvidenceRefs).toEqual([
      'message:message_user_1',
      'message:message_user_2',
    ]);
  });

  it('keeps adjacent exploration in a branch without updating current lesson coverage', () => {
    const initial = createTeachingState({
      lessonId: 'lesson_1',
      sessionId: 'session_1',
      knowledgePointRefs: ['knowledge:kp_1'],
    });
    const next = reduceTeachingState(
      initial,
      observation({
        observationId: 'observation_adjacent',
        scope: {
          alignment: 'adjacent',
          relationRefs: ['course-topic:causal-inference', 'knowledge:kp_1'],
          rationale: 'The question is related to the course but outside this lesson.',
        },
        entries: [
          {
            entryId: 'entry_adjacent',
            kind: 'adjacent_exploration',
            summary: 'The learner explored how the same reasoning changes under intervention.',
            knowledgePointRefs: ['knowledge:kp_1'],
            sourceRefs: ['message:message_user_1'],
            explicitness: 'user_declared',
            resolvesEntryRefs: [],
            qualityFlags: ['direct', 'complete'],
          },
        ],
      }),
    );

    expect(next.knowledgePoints[0]).toMatchObject({
      delivery: 'not_addressed',
      verification: 'not_observed',
    });
    expect(next.explorationBranches).toEqual([
      expect.objectContaining({
        entryId: 'entry_adjacent',
        courseTopicRefs: ['course-topic:causal-inference'],
        returnAnchorRefs: ['knowledge:kp_1'],
        status: 'active',
      }),
    ]);
    expect(next.scopeStatus).toBe('needs_return');
  });
});
