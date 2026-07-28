import { describe, expect, it } from 'vitest';

import { renderTeachingConversationInput } from '../implementation/generation-teaching-agent.js';
import { projectTeachingLedger } from '../implementation/teaching-ledger-projection.js';
import { createTeachingState } from '../implementation/teaching-state-reducer.js';
import type { TeachingContextPackage } from '../ports/teaching-context-sources.js';

function context(
  request: string,
  phase: TeachingContextPackage['teachingState']['lessonPhase'] = 'knowledge_point',
): TeachingContextPackage {
  const refs = ['knowledge:a', 'knowledge:b', 'knowledge:c', 'knowledge:d'];
  const state = createTeachingState({
    lessonId: 'lesson_1',
    sessionId: 'session_1',
    knowledgePointRefs: refs,
  });
  return {
    schemaVersion: 1,
    course: {
      courseId: 'course_1',
      outlineVersionId: 'outline_1',
      title: '课程',
      courseMode: 'standard',
      goals: ['目标'],
      lessonMap: [{ lessonId: 'lesson_1', title: '课节', objective: '目标', relation: 'current' }],
    },
    lesson: {
      lessonId: 'lesson_1',
      outlineVersionId: 'outline_1',
      title: '课节',
      objective: '目标',
      coreKnowledgePoints: refs.map((ref, index) => ({ ref, text: `知识点${index + 1}` })),
    },
    relevantFinalReviews: [],
    readingMaterialExcerpts: [],
    teachingState: {
      ...state,
      lessonPhase: phase,
      activeKnowledgePointRef: 'knowledge:b',
      knowledgePoints: state.knowledgePoints.map((point, index) => ({
        ...point,
        progress: index === 0 ? 'completed' : index === 1 ? 'learning' : 'pending',
        interactionStatus: index === 0 ? 'completed' : 'pending',
        difficultySignals:
          point.ref === 'knowledge:b'
            ? [
                {
                  sourceMessageId: 'old_message',
                  kind: 'request_deeper_explanation' as const,
                },
              ]
            : [],
      })),
    },
    recentMessages: [
      {
        messageId: 'message_1',
        role: 'user',
        completionStatus: 'complete',
        markdown: request,
        sourceRef: 'message:message_1',
      },
    ],
    unobservedMessages: [],
  };
}

describe('projectTeachingLedger', () => {
  it('keeps an ordinary turn bounded to the current and next point', () => {
    const projected = projectTeachingLedger(context('继续'));
    expect(projected.mode).toBe('local');
    expect(projected.knowledgePoints.map((point) => point.ref)).toEqual([
      'knowledge:b',
      'knowledge:c',
    ]);
    expect(projected.knowledgePoints[0]?.deepFollowUpCount).toBe(1);
    expect(projected.completedOrSkippedCount).toBe(1);
  });

  it('adds one explicitly referenced old point without expanding the whole ledger', () => {
    const projected = projectTeachingLedger(context('我想再看知识点1'));
    expect(projected.mode).toBe('local');
    expect(projected.knowledgePoints.map((point) => point.ref)).toEqual([
      'knowledge:a',
      'knowledge:b',
      'knowledge:c',
    ]);
  });

  it('uses a compact full projection for ambiguous references and endpoint phases', () => {
    expect(projectTeachingLedger(context('前面的知识点是什么意思')).mode).toBe('compact_full');
    expect(projectTeachingLedger(context('剩下的知识点全部跳过')).mode).toBe('compact_full');
    expect(
      projectTeachingLedger(context('开始综合应用', 'comprehensive_application')).knowledgePoints,
    ).toHaveLength(4);
  });

  it('keeps an ordinary projection bounded when a lesson has many knowledge points', () => {
    const refs = Array.from({ length: 60 }, (_, index) => `knowledge:point_${index + 1}`);
    const state = createTeachingState({
      lessonId: 'lesson_1',
      sessionId: 'session_1',
      knowledgePointRefs: refs,
    });
    const large: TeachingContextPackage = {
      ...context('继续'),
      lesson: {
        ...context('继续').lesson,
        coreKnowledgePoints: refs.map((ref, index) => ({ ref, text: `知识点${index + 1}` })),
      },
      teachingState: {
        ...state,
        lessonPhase: 'knowledge_point',
        activeKnowledgePointRef: refs[30]!,
        knowledgePoints: state.knowledgePoints.map((point, index) => ({
          ...point,
          progress: index < 30 ? 'completed' : index === 30 ? 'learning' : 'pending',
          interactionStatus: index < 30 ? 'completed' : 'pending',
        })),
      },
    };

    const projected = projectTeachingLedger(large);
    expect(projected.mode).toBe('local');
    expect(projected.knowledgePoints.map((point) => point.ref)).toEqual([refs[30]!, refs[31]!]);
    expect(projected.completedOrSkippedCount).toBe(30);
    expect(projected.totalKnowledgePointCount).toBe(60);
    const smallPrompt = renderTeachingConversationInput(context('继续'));
    const largePrompt = renderTeachingConversationInput(large);
    expect(Math.abs([...largePrompt].length - [...smallPrompt].length)).toBeLessThan(100);
    expect(largePrompt).not.toContain('知识点60');
  });
});
