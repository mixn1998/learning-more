import { describe, expect, it } from 'vitest';

import {
  applyTeachingDirective,
  isExplicitNoFurtherQuestions,
} from '../implementation/teaching-directive.js';
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
    const closed = applyTeachingDirective(
      discussion,
      {
        schemaVersion: 1,
        lessonPhase: 'ready_to_close',
        knowledgePoints: [
          { ref: 'knowledge:kp_1', status: 'completed', interactionStatus: 'completed' },
          { ref: 'knowledge:kp_2', status: 'completed', interactionStatus: 'skipped' },
        ],
        comprehensiveCheck: 'skipped',
        closureInquiry: 'confirmed_no_questions',
        summaryStatus: 'delivered',
      },
      { currentUserMessage: '没有其他问题了，可以结束本课。' },
    );

    expect(closed.lessonPhase).toBe('ready_to_close');
    expect(() =>
      applyTeachingDirective(
        closed,
        {
          schemaVersion: 1,
          lessonPhase: 'ready_to_close',
          knowledgePoints: [
            { ref: 'knowledge:kp_1', status: 'learning', interactionStatus: 'pending' },
            { ref: 'knowledge:kp_2', status: 'completed', interactionStatus: 'skipped' },
          ],
          comprehensiveCheck: 'skipped',
          closureInquiry: 'confirmed_no_questions',
          summaryStatus: 'delivered',
        },
        { currentUserMessage: '没有其他问题了。' },
      ),
    ).toThrowError('teaching_directive_completed_point_regression');
  });

  it('keeps questions in discussion and requires an explicit no-questions reply before closure', () => {
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
      applyTeachingDirective(
        discussion,
        {
          schemaVersion: 1,
          lessonPhase: 'ready_to_close',
          knowledgePoints: [
            { ref: 'knowledge:kp_1', status: 'completed', interactionStatus: 'completed' },
            { ref: 'knowledge:kp_2', status: 'completed', interactionStatus: 'completed' },
          ],
          comprehensiveCheck: 'completed',
          closureInquiry: 'confirmed_no_questions',
          summaryStatus: 'delivered',
        },
        { currentUserMessage: '这个概念还能再解释一下吗？' },
      ),
    ).toThrowError('teaching_directive_explicit_no_questions_required');
  });

  it('recognizes only bounded explicit no-further-questions replies', () => {
    expect(isExplicitNoFurtherQuestions('暂时没有其他疑问了，谢谢。')).toBe(true);
    expect(isExplicitNoFurtherQuestions('可以结束本课')).toBe(true);
    expect(isExplicitNoFurtherQuestions('没有其他问题了，你可以总结一下吧。')).toBe(true);
    expect(isExplicitNoFurtherQuestions('明白了')).toBe(true);
    expect(isExplicitNoFurtherQuestions('这个问题我理解了')).toBe(true);
    expect(isExplicitNoFurtherQuestions('明白了，我还想继续讨论应用场景')).toBe(false);
    expect(isExplicitNoFurtherQuestions('这个问题我理解了，不过还有一个例外')).toBe(false);
    expect(isExplicitNoFurtherQuestions('没有了，但是这个概念为什么成立？')).toBe(false);
    expect(isExplicitNoFurtherQuestions('这个概念能再解释一下吗？')).toBe(false);
  });
});
