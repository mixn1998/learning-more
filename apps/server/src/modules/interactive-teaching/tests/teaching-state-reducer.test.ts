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
  it('starts with a warmup before entering the first knowledge point', () => {
    const initial = createTeachingState({
      lessonId: 'lesson_1',
      sessionId: 'session_1',
      knowledgePointRefs: ['knowledge:kp_1', 'knowledge:kp_2'],
    });

    expect(initial).toMatchObject({
      lessonPhase: 'warmup',
      activeKnowledgePointRef: 'knowledge:kp_1',
      comprehensiveCheck: 'pending',
      closureInquiry: 'pending',
      summaryStatus: 'pending',
    });
    expect(initial.knowledgePoints.map((point) => point.progress)).toEqual(['pending', 'pending']);
  });

  it('preserves the lesson-defined knowledge-point order while removing duplicates', () => {
    const initial = createTeachingState({
      lessonId: 'lesson_1',
      sessionId: 'session_1',
      knowledgePointRefs: ['knowledge:z', 'knowledge:a', 'knowledge:z'],
    });

    expect(initial.activeKnowledgePointRef).toBe('knowledge:z');
    expect(initial.knowledgePoints.map((point) => point.ref)).toEqual([
      'knowledge:z',
      'knowledge:a',
    ]);
  });

  it('does not pass a knowledge point before it has been taught', () => {
    const initial = createTeachingState({
      lessonId: 'lesson_1',
      sessionId: 'session_1',
      knowledgePointRefs: ['knowledge:kp_1'],
    });

    const next = reduceTeachingState(
      initial,
      observation({
        observationId: 'observation_warmup_answer',
        entries: [
          {
            entryId: 'entry_warmup_answer',
            kind: 'learner_demonstration',
            summary: 'The learner showed relevant prior understanding during warmup.',
            knowledgePointRefs: ['knowledge:kp_1'],
            sourceRefs: ['message:message_user_1'],
            assessment: 'supports',
            resolvesEntryRefs: [],
            qualityFlags: ['direct', 'complete'],
          },
        ],
      }),
    );

    expect(next).toMatchObject({
      lessonPhase: 'knowledge_point',
      activeKnowledgePointRef: 'knowledge:kp_1',
    });
    expect(next.knowledgePoints[0]).toMatchObject({
      delivery: 'not_addressed',
      verification: 'supporting',
      progress: 'pending',
    });
  });

  it('advances only after a knowledge point is passed or explicitly skipped with no open question', () => {
    const initial = createTeachingState({
      lessonId: 'lesson_1',
      sessionId: 'session_1',
      knowledgePointRefs: ['knowledge:kp_1', 'knowledge:kp_2'],
    });
    const firstPassed = reduceTeachingState(
      initial,
      observation({
        observationId: 'observation_first_passed',
        entries: [
          {
            entryId: 'entry_first_taught',
            kind: 'teaching_delivery',
            summary: 'The assistant taught the first knowledge point.',
            knowledgePointRefs: ['knowledge:kp_1'],
            sourceRefs: ['message:message_ai_1'],
            resolvesEntryRefs: [],
            qualityFlags: ['direct', 'complete'],
          },
          {
            entryId: 'entry_first_passed',
            kind: 'learner_demonstration',
            summary: 'The learner answered the first check correctly.',
            knowledgePointRefs: ['knowledge:kp_1'],
            sourceRefs: ['message:message_user_1'],
            assessment: 'supports',
            resolvesEntryRefs: [],
            qualityFlags: ['direct', 'complete'],
          },
        ],
      }),
    );

    expect(firstPassed).toMatchObject({
      lessonPhase: 'knowledge_point',
      activeKnowledgePointRef: 'knowledge:kp_2',
    });
    expect(firstPassed.knowledgePoints.map((point) => point.progress)).toEqual([
      'passed',
      'pending',
    ]);

    const secondSkipped = reduceTeachingState(
      firstPassed,
      observation({
        observationId: 'observation_second_skipped',
        turnSequence: 2,
        sourceSnapshotHash: 'b'.repeat(64),
        entries: [
          {
            entryId: 'entry_second_skipped',
            kind: 'learner_intent',
            summary: 'The learner explicitly chose to skip the second knowledge point.',
            knowledgePointRefs: ['knowledge:kp_2'],
            sourceRefs: ['message:message_user_1'],
            progressionSignal: 'skip_knowledge_point',
            resolvesEntryRefs: [],
            qualityFlags: ['direct', 'complete'],
          },
        ],
      }),
    );

    expect(secondSkipped).toMatchObject({
      lessonPhase: 'comprehensive_check',
      comprehensiveCheck: 'checking',
    });
    expect(secondSkipped.activeKnowledgePointRef).toBeUndefined();
    expect(Object.hasOwn(secondSkipped, 'activeKnowledgePointRef')).toBe(false);
    expect(secondSkipped.knowledgePoints.map((point) => point.progress)).toEqual([
      'passed',
      'skipped',
    ]);

    const comprehensivePassed = reduceTeachingState(
      secondSkipped,
      observation({
        observationId: 'observation_comprehensive_passed',
        turnSequence: 3,
        sourceSnapshotHash: 'c'.repeat(64),
        entries: [
          {
            entryId: 'entry_comprehensive_passed',
            kind: 'learner_demonstration',
            summary: 'The learner connected the lesson knowledge in the comprehensive check.',
            knowledgePointRefs: [],
            sourceRefs: ['message:message_user_1'],
            assessment: 'supports',
            progressionSignal: 'pass_comprehensive_check',
            resolvesEntryRefs: [],
            qualityFlags: ['direct', 'complete'],
          },
        ],
      }),
    );
    expect(comprehensivePassed).toMatchObject({
      lessonPhase: 'summary',
      comprehensiveCheck: 'passed',
      closureInquiry: 'awaiting_confirmation',
      summaryStatus: 'pending',
    });

    const prematureSummary = reduceTeachingState(
      comprehensivePassed,
      observation({
        observationId: 'observation_summary_delivered',
        turnSequence: 4,
        sourceSnapshotHash: 'd'.repeat(64),
        entries: [
          {
            entryId: 'entry_summary_delivered',
            kind: 'teaching_delivery',
            summary: 'The assistant summarized all lesson knowledge and their relationships.',
            knowledgePointRefs: [],
            sourceRefs: ['message:message_ai_1'],
            progressionSignal: 'lesson_summary_delivered',
            resolvesEntryRefs: [],
            qualityFlags: ['direct', 'complete'],
          },
        ],
      }),
    );
    expect(prematureSummary).toMatchObject({
      lessonPhase: 'summary',
      closureInquiry: 'awaiting_confirmation',
      summaryStatus: 'pending',
    });

    const summarized = reduceTeachingState(
      prematureSummary,
      observation({
        observationId: 'observation_no_questions_and_summary',
        turnSequence: 5,
        sourceSnapshotHash: 'e'.repeat(64),
        entries: [
          {
            entryId: 'entry_no_questions',
            kind: 'learner_intent',
            summary: 'The learner explicitly said there are no remaining questions.',
            knowledgePointRefs: [],
            sourceRefs: ['message:message_user_1'],
            progressionSignal: 'confirm_no_further_questions',
            resolvesEntryRefs: [],
            qualityFlags: ['direct', 'complete'],
          },
          {
            entryId: 'entry_final_summary',
            kind: 'teaching_delivery',
            summary: 'The assistant delivered the final lesson summary.',
            knowledgePointRefs: [],
            sourceRefs: ['message:message_ai_1'],
            progressionSignal: 'lesson_summary_delivered',
            resolvesEntryRefs: [],
            qualityFlags: ['direct', 'complete'],
          },
        ],
      }),
    );
    expect(summarized).toMatchObject({
      lessonPhase: 'ready_to_close',
      closureInquiry: 'confirmed_no_questions',
      summaryStatus: 'delivered',
    });
  });

  it('allows an explicitly skipped comprehensive check to use the same closure inquiry', () => {
    const initial = createTeachingState({
      lessonId: 'lesson_1',
      sessionId: 'session_1',
      knowledgePointRefs: [],
    });
    const skipped = reduceTeachingState(
      initial,
      observation({
        observationId: 'observation_comprehensive_skipped',
        entries: [
          {
            entryId: 'entry_comprehensive_skipped',
            kind: 'learner_intent',
            summary: 'The learner explicitly skipped the comprehensive check.',
            knowledgePointRefs: [],
            sourceRefs: ['message:message_user_1'],
            progressionSignal: 'skip_comprehensive_check',
            resolvesEntryRefs: [],
            qualityFlags: ['direct', 'complete'],
          },
        ],
      }),
    );

    expect(skipped).toMatchObject({
      lessonPhase: 'summary',
      comprehensiveCheck: 'skipped',
      closureInquiry: 'awaiting_confirmation',
      summaryStatus: 'pending',
    });
  });

  it('keeps the current knowledge point active while a related question remains unresolved', () => {
    const initial = createTeachingState({
      lessonId: 'lesson_1',
      sessionId: 'session_1',
      knowledgePointRefs: ['knowledge:kp_1', 'knowledge:kp_2'],
    });
    const next = reduceTeachingState(
      initial,
      observation({
        observationId: 'observation_question_after_check',
        entries: [
          {
            entryId: 'entry_taught',
            kind: 'teaching_delivery',
            summary: 'The assistant taught the first knowledge point.',
            knowledgePointRefs: ['knowledge:kp_1'],
            sourceRefs: ['message:message_ai_1'],
            resolvesEntryRefs: [],
            qualityFlags: ['direct', 'complete'],
          },
          {
            entryId: 'entry_passed',
            kind: 'learner_demonstration',
            summary: 'The learner passed the check.',
            knowledgePointRefs: ['knowledge:kp_1'],
            sourceRefs: ['message:message_user_1'],
            assessment: 'supports',
            resolvesEntryRefs: [],
            qualityFlags: ['direct', 'complete'],
          },
          {
            entryId: 'entry_open_question',
            kind: 'open_loop',
            summary: 'The learner still has a related unanswered question.',
            knowledgePointRefs: ['knowledge:kp_1'],
            sourceRefs: ['message:message_user_1'],
            resolvesEntryRefs: [],
            qualityFlags: ['direct', 'complete'],
          },
        ],
      }),
    );

    expect(next).toMatchObject({
      lessonPhase: 'knowledge_point',
      activeKnowledgePointRef: 'knowledge:kp_1',
    });
    expect(next.knowledgePoints[0]).toMatchObject({
      progress: 'checking',
      unresolvedEntryRefs: ['entry_open_question'],
    });
  });

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
