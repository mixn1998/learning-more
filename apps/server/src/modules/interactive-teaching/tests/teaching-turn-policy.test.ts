import { describe, expect, it } from 'vitest';

import { createTeachingState } from '../implementation/teaching-state-reducer.js';
import { reasoningEffortForTeachingTurn } from '../implementation/teaching-turn-policy.js';
import type { TeachingContextPackage } from '../ports/teaching-context-sources.js';

function context(
  input: {
    phase?: TeachingContextPackage['teachingState']['lessonPhase'];
    activeRef?: string;
    request?: string;
    key?: boolean;
    signals?: readonly Readonly<{
      sourceMessageId: string;
      kind: 'request_deeper_explanation';
    }>[];
  } = {},
): TeachingContextPackage {
  const state = createTeachingState({
    lessonId: 'lesson_1',
    sessionId: 'session_1',
    knowledgePointRefs: ['knowledge:a', 'knowledge:b'],
  });
  return {
    schemaVersion: 1,
    course: {
      courseId: 'course_1',
      outlineVersionId: 'outline_1',
      title: '课程',
      courseMode: 'standard',
      goals: ['掌握课程'],
      lessonMap: [{ lessonId: 'lesson_1', title: '课节', objective: '目标', relation: 'current' }],
    },
    lesson: {
      lessonId: 'lesson_1',
      outlineVersionId: 'outline_1',
      title: '课节',
      objective: '理解概念',
      coreKnowledgePoints: [
        { ref: 'knowledge:a', text: '概念 A', fixedImportance: input.key ? 'key' : 'normal' },
        { ref: 'knowledge:b', text: '概念 B', fixedImportance: 'normal' },
      ],
    },
    relevantFinalReviews: [],
    readingMaterialExcerpts: [],
    teachingState: {
      ...state,
      lessonPhase: input.phase ?? 'knowledge_point',
      activeKnowledgePointRef: input.activeRef ?? 'knowledge:a',
      knowledgePoints: state.knowledgePoints.map((point) =>
        point.ref === 'knowledge:a'
          ? { ...point, difficultySignals: [...(input.signals ?? [])] }
          : point,
      ),
    },
    recentMessages: [
      {
        messageId: 'message_1',
        role: 'user',
        completionStatus: 'complete',
        markdown: input.request ?? '我认为答案是 3。',
        sourceRef: 'message:message_1',
      },
    ],
    unobservedMessages: [],
  };
}

describe('reasoningEffortForTeachingTurn', () => {
  it('uses low for routine turns and medium for fixed key points', () => {
    expect(reasoningEffortForTeachingTurn(context())).toBe('low');
    expect(reasoningEffortForTeachingTurn(context({ key: true }))).toBe('medium');
  });

  it('uses medium for the first substantive follow-up and high from the second', () => {
    expect(reasoningEffortForTeachingTurn(context({ request: '为什么这个条件成立？' }))).toBe(
      'medium',
    );
    expect(
      reasoningEffortForTeachingTurn(
        context({
          request: '我还是不理解，能再深入解释吗？',
          signals: [{ sourceMessageId: 'message_previous', kind: 'request_deeper_explanation' }],
        }),
      ),
    ).toBe('high');
  });

  it('scopes follow-up history by session state and knowledge-point ref', () => {
    const revisited = context({
      activeRef: 'knowledge:a',
      request: '能再举一个反例吗？',
      signals: [{ sourceMessageId: 'message_previous', kind: 'request_deeper_explanation' }],
    });
    expect(reasoningEffortForTeachingTurn(revisited)).toBe('high');
    expect(
      reasoningEffortForTeachingTurn({
        ...revisited,
        teachingState: { ...revisited.teachingState, activeKnowledgePointRef: 'knowledge:b' },
      }),
    ).toBe('medium');
  });

  it('uses low for warmup and summary, medium for checks and discussion', () => {
    expect(reasoningEffortForTeachingTurn(context({ phase: 'warmup' }))).toBe('low');
    expect(reasoningEffortForTeachingTurn(context({ phase: 'summary' }))).toBe('low');
    expect(reasoningEffortForTeachingTurn(context({ phase: 'comprehensive_application' }))).toBe(
      'medium',
    );
    expect(reasoningEffortForTeachingTurn(context({ phase: 'discussion' }))).toBe('medium');
  });
});
