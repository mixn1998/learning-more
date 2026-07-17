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
});
