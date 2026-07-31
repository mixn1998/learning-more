import { describe, expect, it } from 'vitest';

import { capabilitiesForTeachingTurn } from '../implementation/teaching-capability-router.js';
import { createTeachingState } from '../implementation/teaching-state-reducer.js';
import type { TeachingContextPackage } from '../ports/teaching-context-sources.js';

function context(
  request: string,
  point = '商业市场分析',
  courseTitle = '课程',
): TeachingContextPackage {
  const state = createTeachingState({
    lessonId: 'lesson_1',
    sessionId: 'session_1',
    knowledgePointRefs: ['knowledge:a'],
  });
  return {
    schemaVersion: 1,
    course: {
      courseId: 'course_1',
      outlineVersionId: 'outline_1',
      title: courseTitle,
      courseMode: 'standard',
      goals: ['目标'],
      lessonMap: [{ lessonId: 'lesson_1', title: '课节', objective: '目标', relation: 'current' }],
    },
    lesson: {
      lessonId: 'lesson_1',
      outlineVersionId: 'outline_1',
      title: '课节',
      objective: point,
      coreKnowledgePoints: [{ ref: 'knowledge:a', text: point }],
    },
    relevantFinalReviews: [],
    readingMaterialExcerpts: [],
    teachingState: {
      ...state,
      lessonPhase: 'knowledge_point',
      activeKnowledgePointRef: 'knowledge:a',
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

describe('capabilitiesForTeachingTurn', () => {
  it('includes math-plot for explicit visual requests and mathematical visual topics', () => {
    expect(capabilitiesForTeachingTurn(context('请画图说明', '商业分析')).has('math-plot')).toBe(
      true,
    );
    expect(capabilitiesForTeachingTurn(context('继续', '向量与坐标表示')).has('math-plot')).toBe(
      true,
    );
  });

  it('does not treat 市场 or 场景 as a mathematical field', () => {
    expect(capabilitiesForTeachingTurn(context('继续讲解', '市场场景分析')).has('math-plot')).toBe(
      false,
    );
  });

  it('makes geometric tools available throughout mathematical courses', () => {
    expect(
      capabilitiesForTeachingTurn(context('继续讲解', '初等行变换的可逆性', '线性代数')).has(
        'math-plot',
      ),
    ).toBe(true);
  });

  it('continues the capability after a prior math-plot result', () => {
    const base = context('继续解释', '商业分析');
    expect(
      capabilitiesForTeachingTurn({
        ...base,
        recentMessages: [
          {
            messageId: 'assistant_1',
            role: 'assistant',
            completionStatus: 'complete',
            markdown: '```math-plot\n{}\n```',
            sourceRef: 'message:assistant_1',
          },
          ...base.recentMessages,
        ],
      }).has('math-plot'),
    ).toBe(true);
  });
});
