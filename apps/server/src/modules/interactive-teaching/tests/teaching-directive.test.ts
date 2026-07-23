import { describe, expect, it } from 'vitest';

import { applyTeachingDirective } from '../implementation/teaching-directive.js';
import { createTeachingState } from '../implementation/teaching-state-reducer.js';

function initial() {
  return createTeachingState({
    lessonId: 'lesson_1',
    sessionId: 'session_1',
    knowledgePointRefs: ['knowledge:kp_1', 'knowledge:kp_2'],
  });
}

describe('teaching directive', () => {
  it('materializes a sparse version 2 update against the authoritative ledger', () => {
    const next = applyTeachingDirective(initial(), {
      schemaVersion: 2,
      lessonPhase: 'knowledge_point',
      activeKnowledgePointRef: 'knowledge:kp_1',
      knowledgePoints: [{ ref: 'knowledge:kp_1', status: 'learning' }],
    });

    expect(next).toMatchObject({
      lessonPhase: 'knowledge_point',
      activeKnowledgePointRef: 'knowledge:kp_1',
      comprehensiveCheck: 'pending',
      closureInquiry: 'pending',
      summaryStatus: 'pending',
      knowledgePoints: [
        { ref: 'knowledge:kp_1', progress: 'learning', interactionStatus: 'pending' },
        { ref: 'knowledge:kp_2', progress: 'pending', interactionStatus: 'pending' },
      ],
    });
  });

  it('applies a sparse completion without requiring unchanged knowledge points', () => {
    const learning = applyTeachingDirective(initial(), {
      schemaVersion: 2,
      lessonPhase: 'knowledge_point',
      activeKnowledgePointRef: 'knowledge:kp_1',
      knowledgePoints: [{ ref: 'knowledge:kp_1', status: 'learning' }],
    });
    const advanced = applyTeachingDirective(learning, {
      schemaVersion: 2,
      activeKnowledgePointRef: 'knowledge:kp_2',
      knowledgePoints: [
        {
          ref: 'knowledge:kp_1',
          status: 'completed',
          interactionStatus: 'completed',
        },
        { ref: 'knowledge:kp_2', status: 'learning' },
      ],
    });

    expect(advanced.knowledgePoints).toMatchObject([
      { progress: 'completed', interactionStatus: 'completed' },
      { progress: 'learning', interactionStatus: 'pending' },
    ]);
  });

  it('stores the learner-requested condensed depth as a session-only ledger override', () => {
    const next = applyTeachingDirective(initial(), {
      schemaVersion: 1,
      lessonPhase: 'knowledge_point',
      activeKnowledgePointRef: 'knowledge:kp_1',
      knowledgePoints: [
        {
          ref: 'knowledge:kp_1',
          status: 'learning',
          interactionStatus: 'pending',
          depthPreference: 'condensed',
        },
        { ref: 'knowledge:kp_2', status: 'pending', interactionStatus: 'pending' },
      ],
      comprehensiveCheck: 'pending',
      closureInquiry: 'pending',
      summaryStatus: 'pending',
    });

    expect(next.knowledgePoints).toMatchObject([
      { ref: 'knowledge:kp_1', depthPreference: 'condensed' },
      { ref: 'knowledge:kp_2', depthPreference: 'default' },
    ]);
  });

  it('lets the teaching agent advance knowledge-point completion independently of observation', () => {
    const learning = applyTeachingDirective(initial(), {
      schemaVersion: 1,
      lessonPhase: 'knowledge_point',
      activeKnowledgePointRef: 'knowledge:kp_1',
      knowledgePoints: [
        { ref: 'knowledge:kp_1', status: 'learning', interactionStatus: 'pending' },
        { ref: 'knowledge:kp_2', status: 'pending', interactionStatus: 'pending' },
      ],
      comprehensiveCheck: 'pending',
      closureInquiry: 'pending',
      summaryStatus: 'pending',
    });

    const advanced = applyTeachingDirective(learning, {
      schemaVersion: 1,
      lessonPhase: 'knowledge_point',
      activeKnowledgePointRef: 'knowledge:kp_2',
      knowledgePoints: [
        { ref: 'knowledge:kp_1', status: 'completed', interactionStatus: 'completed' },
        { ref: 'knowledge:kp_2', status: 'learning', interactionStatus: 'pending' },
      ],
      comprehensiveCheck: 'pending',
      closureInquiry: 'pending',
      summaryStatus: 'pending',
    });

    expect(advanced).toMatchObject({
      lessonPhase: 'knowledge_point',
      activeKnowledgePointRef: 'knowledge:kp_2',
      knowledgePoints: [
        { progress: 'completed', interactionStatus: 'completed' },
        { progress: 'learning', interactionStatus: 'pending' },
      ],
    });
  });

  it('distinguishes a skipped knowledge point from a skipped knowledge-point interaction', () => {
    const next = applyTeachingDirective(initial(), {
      schemaVersion: 1,
      lessonPhase: 'comprehensive_check',
      knowledgePoints: [
        { ref: 'knowledge:kp_1', status: 'completed', interactionStatus: 'skipped' },
        { ref: 'knowledge:kp_2', status: 'skipped', interactionStatus: 'skipped' },
      ],
      comprehensiveCheck: 'learning',
      closureInquiry: 'pending',
      summaryStatus: 'pending',
    });

    expect(next.knowledgePoints).toMatchObject([
      { progress: 'completed', interactionStatus: 'skipped' },
      { progress: 'skipped', interactionStatus: 'skipped' },
    ]);
  });

  it('accepts a complete closure snapshot and rejects completed-node regression', () => {
    const discussion = applyTeachingDirective(initial(), {
      schemaVersion: 1,
      lessonPhase: 'discussion',
      knowledgePoints: [
        { ref: 'knowledge:kp_1', status: 'completed', interactionStatus: 'completed' },
        { ref: 'knowledge:kp_2', status: 'completed', interactionStatus: 'skipped' },
      ],
      comprehensiveCheck: 'skipped',
      closureInquiry: 'awaiting_confirmation',
      summaryStatus: 'pending',
    });
    const closed = applyTeachingDirective(discussion, {
      schemaVersion: 1,
      lessonPhase: 'ready_to_close',
      knowledgePoints: [
        { ref: 'knowledge:kp_1', status: 'completed', interactionStatus: 'completed' },
        { ref: 'knowledge:kp_2', status: 'completed', interactionStatus: 'skipped' },
      ],
      comprehensiveCheck: 'skipped',
      closureInquiry: 'confirmed_no_questions',
      summaryStatus: 'delivered',
    });

    expect(closed.lessonPhase).toBe('ready_to_close');
    expect(() =>
      applyTeachingDirective(closed, {
        schemaVersion: 1,
        lessonPhase: 'ready_to_close',
        knowledgePoints: [
          { ref: 'knowledge:kp_1', status: 'learning', interactionStatus: 'pending' },
          { ref: 'knowledge:kp_2', status: 'completed', interactionStatus: 'skipped' },
        ],
        comprehensiveCheck: 'skipped',
        closureInquiry: 'confirmed_no_questions',
        summaryStatus: 'delivered',
      }),
    ).toThrowError('teaching_directive_completed_point_regression');
  });

  it('accepts the teaching agent semantic closure decision without matching learner wording', () => {
    const discussion = applyTeachingDirective(initial(), {
      schemaVersion: 1,
      lessonPhase: 'discussion',
      knowledgePoints: [
        { ref: 'knowledge:kp_1', status: 'completed', interactionStatus: 'completed' },
        { ref: 'knowledge:kp_2', status: 'completed', interactionStatus: 'completed' },
      ],
      comprehensiveCheck: 'completed',
      closureInquiry: 'awaiting_confirmation',
      summaryStatus: 'pending',
    });

    const closed = applyTeachingDirective(discussion, {
      schemaVersion: 1,
      lessonPhase: 'ready_to_close',
      knowledgePoints: [
        { ref: 'knowledge:kp_1', status: 'completed', interactionStatus: 'completed' },
        { ref: 'knowledge:kp_2', status: 'completed', interactionStatus: 'completed' },
      ],
      comprehensiveCheck: 'completed',
      closureInquiry: 'confirmed_no_questions',
      summaryStatus: 'delivered',
    });

    expect(closed).toMatchObject({
      lessonPhase: 'ready_to_close',
      closureInquiry: 'confirmed_no_questions',
      summaryStatus: 'delivered',
    });
  });

  it('accepts an atomic closure turn after the comprehensive check is completed', () => {
    const comprehensiveCheck = applyTeachingDirective(initial(), {
      schemaVersion: 1,
      lessonPhase: 'comprehensive_check',
      knowledgePoints: [
        { ref: 'knowledge:kp_1', status: 'completed', interactionStatus: 'completed' },
        { ref: 'knowledge:kp_2', status: 'skipped', interactionStatus: 'skipped' },
      ],
      comprehensiveCheck: 'learning',
      closureInquiry: 'pending',
      summaryStatus: 'pending',
    });

    const closed = applyTeachingDirective(comprehensiveCheck, {
      schemaVersion: 1,
      lessonPhase: 'ready_to_close',
      knowledgePoints: [
        { ref: 'knowledge:kp_1', status: 'completed', interactionStatus: 'completed' },
        { ref: 'knowledge:kp_2', status: 'skipped', interactionStatus: 'skipped' },
      ],
      comprehensiveCheck: 'completed',
      closureInquiry: 'confirmed_no_questions',
      summaryStatus: 'delivered',
    });

    expect(closed).toMatchObject({
      lessonPhase: 'ready_to_close',
      comprehensiveCheck: 'completed',
      closureInquiry: 'confirmed_no_questions',
      summaryStatus: 'delivered',
    });
  });

  it('rejects closure-state combinations that are illegal for their phase', () => {
    const discussion = applyTeachingDirective(initial(), {
      schemaVersion: 1,
      lessonPhase: 'discussion',
      knowledgePoints: [
        { ref: 'knowledge:kp_1', status: 'completed', interactionStatus: 'completed' },
        { ref: 'knowledge:kp_2', status: 'completed', interactionStatus: 'completed' },
      ],
      comprehensiveCheck: 'completed',
      closureInquiry: 'awaiting_confirmation',
      summaryStatus: 'pending',
    });

    expect(() =>
      applyTeachingDirective(discussion, {
        schemaVersion: 1,
        lessonPhase: 'summary',
        knowledgePoints: [
          { ref: 'knowledge:kp_1', status: 'completed', interactionStatus: 'completed' },
          { ref: 'knowledge:kp_2', status: 'completed', interactionStatus: 'completed' },
        ],
        comprehensiveCheck: 'completed',
        closureInquiry: 'awaiting_confirmation',
        summaryStatus: 'pending',
      }),
    ).toThrowError('teaching_directive_closure_state_mismatch');

    expect(() =>
      applyTeachingDirective(initial(), {
        schemaVersion: 1,
        lessonPhase: 'knowledge_point',
        activeKnowledgePointRef: 'knowledge:kp_1',
        knowledgePoints: [
          { ref: 'knowledge:kp_1', status: 'learning', interactionStatus: 'pending' },
          { ref: 'knowledge:kp_2', status: 'pending', interactionStatus: 'pending' },
        ],
        comprehensiveCheck: 'pending',
        closureInquiry: 'awaiting_confirmation',
        summaryStatus: 'pending',
      }),
    ).toThrowError('teaching_directive_closure_state_mismatch');
  });

  it('marks a knowledge point difficult after two distinct signal kinds in one answer', () => {
    const directive = {
      schemaVersion: 1 as const,
      lessonPhase: 'knowledge_point' as const,
      activeKnowledgePointRef: 'knowledge:kp_1',
      knowledgePoints: [
        {
          ref: 'knowledge:kp_1',
          status: 'learning' as const,
          interactionStatus: 'pending' as const,
        },
        {
          ref: 'knowledge:kp_2',
          status: 'pending' as const,
          interactionStatus: 'pending' as const,
        },
      ],
      difficultySignals: [
        {
          knowledgePointRef: 'knowledge:kp_1',
          sourceMessageId: 'message_1',
          kind: 'answer_error' as const,
        },
        {
          knowledgePointRef: 'knowledge:kp_1',
          sourceMessageId: 'message_1',
          kind: 'not_understood' as const,
        },
      ],
      comprehensiveCheck: 'pending' as const,
      closureInquiry: 'pending' as const,
      summaryStatus: 'pending' as const,
    };

    const next = applyTeachingDirective(initial(), directive, {
      currentUserMessageId: 'message_1',
    });

    expect(next.knowledgePoints[0]).toMatchObject({
      adaptiveDifficulty: 'difficult',
      difficultySignals: [
        { sourceMessageId: 'message_1', kind: 'answer_error' },
        { sourceMessageId: 'message_1', kind: 'not_understood' },
      ],
    });

    const replayed = applyTeachingDirective(next, directive, {
      currentUserMessageId: 'message_1',
    });
    expect(replayed.knowledgePoints[0]?.difficultySignals).toHaveLength(2);
  });

  it('accumulates different difficulty signals across user messages', () => {
    const first = applyTeachingDirective(
      initial(),
      {
        schemaVersion: 1,
        lessonPhase: 'knowledge_point',
        activeKnowledgePointRef: 'knowledge:kp_1',
        knowledgePoints: [
          { ref: 'knowledge:kp_1', status: 'learning', interactionStatus: 'pending' },
          { ref: 'knowledge:kp_2', status: 'pending', interactionStatus: 'pending' },
        ],
        difficultySignals: [
          {
            knowledgePointRef: 'knowledge:kp_1',
            sourceMessageId: 'message_1',
            kind: 'misunderstanding',
          },
        ],
        comprehensiveCheck: 'pending',
        closureInquiry: 'pending',
        summaryStatus: 'pending',
      },
      { currentUserMessageId: 'message_1' },
    );
    const second = applyTeachingDirective(
      first,
      {
        schemaVersion: 1,
        lessonPhase: 'knowledge_point',
        activeKnowledgePointRef: 'knowledge:kp_1',
        knowledgePoints: [
          { ref: 'knowledge:kp_1', status: 'learning', interactionStatus: 'pending' },
          { ref: 'knowledge:kp_2', status: 'pending', interactionStatus: 'pending' },
        ],
        difficultySignals: [
          {
            knowledgePointRef: 'knowledge:kp_1',
            sourceMessageId: 'message_2',
            kind: 'request_deeper_explanation',
          },
        ],
        comprehensiveCheck: 'pending',
        closureInquiry: 'pending',
        summaryStatus: 'pending',
      },
      { currentUserMessageId: 'message_2' },
    );

    expect(second.knowledgePoints[0]).toMatchObject({ adaptiveDifficulty: 'difficult' });
    expect(second.knowledgePoints[0]?.difficultySignals).toHaveLength(2);
  });

  it('rejects duplicate signal tuples and signals attributed to another user message', () => {
    const base = {
      schemaVersion: 1 as const,
      lessonPhase: 'knowledge_point' as const,
      activeKnowledgePointRef: 'knowledge:kp_1',
      knowledgePoints: [
        {
          ref: 'knowledge:kp_1',
          status: 'learning' as const,
          interactionStatus: 'pending' as const,
        },
        {
          ref: 'knowledge:kp_2',
          status: 'pending' as const,
          interactionStatus: 'pending' as const,
        },
      ],
      comprehensiveCheck: 'pending' as const,
      closureInquiry: 'pending' as const,
      summaryStatus: 'pending' as const,
    };

    expect(() =>
      applyTeachingDirective(
        initial(),
        {
          ...base,
          difficultySignals: [
            {
              knowledgePointRef: 'knowledge:kp_1',
              sourceMessageId: 'message_1',
              kind: 'misunderstanding' as const,
            },
            {
              knowledgePointRef: 'knowledge:kp_1',
              sourceMessageId: 'message_1',
              kind: 'misunderstanding' as const,
            },
          ],
        },
        { currentUserMessageId: 'message_1' },
      ),
    ).toThrowError('teaching_directive_difficulty_signal_duplicate');

    expect(() =>
      applyTeachingDirective(
        initial(),
        {
          ...base,
          difficultySignals: [
            {
              knowledgePointRef: 'knowledge:kp_1',
              sourceMessageId: 'message_other',
              kind: 'misunderstanding' as const,
            },
          ],
        },
        { currentUserMessageId: 'message_1' },
      ),
    ).toThrowError('teaching_directive_difficulty_signal_source_mismatch');
  });
});

describe('teaching verification progress cap', () => {
  it('forces progress after two consecutive correct answers in the same category', () => {
    const first = applyTeachingDirective(
      initial(),
      {
        schemaVersion: 2,
        lessonPhase: 'knowledge_point',
        activeKnowledgePointRef: 'knowledge:kp_1',
        knowledgePoints: [{ ref: 'knowledge:kp_1', status: 'learning' }],
        verificationSignals: [
          {
            knowledgePointRef: 'knowledge:kp_1',
            sourceMessageId: 'message_1',
            category: 'counterexample-construction',
            outcome: 'correct',
          },
        ],
      },
      { currentUserMessageId: 'message_1' },
    );

    expect(first.knowledgePoints[0]?.verificationStreak).toEqual({
      category: 'counterexample-construction',
      correctCount: 1,
      sourceMessageIds: ['message_1'],
    });

    const second = applyTeachingDirective(
      first,
      {
        schemaVersion: 2,
        lessonPhase: 'knowledge_point',
        verificationSignals: [
          {
            knowledgePointRef: 'knowledge:kp_1',
            sourceMessageId: 'message_2',
            category: 'counterexample-construction',
            outcome: 'correct',
          },
        ],
      },
      { currentUserMessageId: 'message_2' },
    );

    expect(second).toMatchObject({
      lessonPhase: 'knowledge_point',
      activeKnowledgePointRef: 'knowledge:kp_2',
      knowledgePoints: [
        {
          progress: 'completed',
          interactionStatus: 'completed',
          verificationStreak: {
            category: 'counterexample-construction',
            correctCount: 2,
            sourceMessageIds: ['message_1', 'message_2'],
          },
        },
        { progress: 'learning', interactionStatus: 'pending' },
      ],
    });
  });

  it('resets the streak when the verification category changes', () => {
    const state = {
      ...initial(),
      lessonPhase: 'knowledge_point' as const,
      activeKnowledgePointRef: 'knowledge:kp_1',
      knowledgePoints: initial().knowledgePoints.map((point, index) =>
        index === 0
          ? {
              ...point,
              progress: 'learning' as const,
              verificationStreak: {
                category: 'definition-recall',
                correctCount: 1 as const,
                sourceMessageIds: ['message_1'],
              },
            }
          : point,
      ),
    };
    const next = applyTeachingDirective(
      state,
      {
        schemaVersion: 2,
        lessonPhase: 'knowledge_point',
        verificationSignals: [
          {
            knowledgePointRef: 'knowledge:kp_1',
            sourceMessageId: 'message_2',
            category: 'boundary-application',
            outcome: 'correct',
          },
        ],
      },
      { currentUserMessageId: 'message_2' },
    );

    expect(next.activeKnowledgePointRef).toBe('knowledge:kp_1');
    expect(next.knowledgePoints[0]?.verificationStreak).toEqual({
      category: 'boundary-application',
      correctCount: 1,
      sourceMessageIds: ['message_2'],
    });
  });

  it('rejects a verification signal attributed to another user message', () => {
    expect(() =>
      applyTeachingDirective(
        initial(),
        {
          schemaVersion: 2,
          lessonPhase: 'knowledge_point',
          activeKnowledgePointRef: 'knowledge:kp_1',
          knowledgePoints: [{ ref: 'knowledge:kp_1', status: 'learning' }],
          verificationSignals: [
            {
              knowledgePointRef: 'knowledge:kp_1',
              sourceMessageId: 'message_other',
              category: 'definition-recall',
              outcome: 'correct',
            },
          ],
        },
        { currentUserMessageId: 'message_current' },
      ),
    ).toThrowError('teaching_directive_verification_signal_source_mismatch');
  });
});
