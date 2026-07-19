import { describe, expect, it } from 'vitest';

import { renderTeachingDepthPolicy } from '../implementation/teaching-depth-policy.js';
import { createTeachingState } from '../implementation/teaching-state-reducer.js';
import type { TeachingContextPackage } from '../ports/teaching-context-sources.js';

function context(input: {
  fixedImportance?: 'normal' | 'key';
  adaptiveDifficulty?: 'normal' | 'difficult';
}): TeachingContextPackage {
  const teachingState = createTeachingState({
    lessonId: 'lesson_1',
    sessionId: 'session_1',
    knowledgePointRefs: ['knowledge:kp_1'],
  });
  return {
    schemaVersion: 1,
    course: {
      courseId: 'course_1',
      outlineVersionId: 'outline_1',
      title: 'Course',
      courseMode: 'standard',
      goals: [],
      lessonMap: [],
    },
    lesson: {
      lessonId: 'lesson_1',
      outlineVersionId: 'outline_1',
      title: 'Lesson',
      objective: 'Understand the point',
      coreKnowledgePoints: [
        {
          ref: 'knowledge:kp_1',
          text: 'Boundary conditions',
          ...(input.fixedImportance === undefined
            ? {}
            : { fixedImportance: input.fixedImportance }),
        },
      ],
    },
    relevantFinalReviews: [],
    readingMaterialExcerpts: [],
    personalization: {
      profileVersion: 0,
      purpose: 'interactive_teaching',
      courseId: 'course_1',
      lessonId: 'lesson_1',
      signals: [],
      completeness: 'insufficient',
      sourceSnapshotHash: '0'.repeat(64),
      createdAt: '2026-07-19T00:00:00.000Z',
    },
    teachingState: {
      ...teachingState,
      lessonPhase: 'knowledge_point',
      activeKnowledgePointRef: 'knowledge:kp_1',
      knowledgePoints: teachingState.knowledgePoints.map((point) => ({
        ...point,
        adaptiveDifficulty: input.adaptiveDifficulty ?? 'normal',
      })),
    },
    recentMessages: [],
    unobservedMessages: [],
  };
}

describe('teaching depth policy', () => {
  it('keeps normal knowledge points concise and proportionate', () => {
    const rendered = renderTeachingDepthPolicy(context({}));
    expect(rendered).toContain('【教学深模块｜普通知识点】');
    expect(rendered).toContain('详略得当');
    expect(rendered).not.toContain('典型误区');
  });

  it('expands fixed key points with boundaries, counterexamples, misconceptions and dense interaction', () => {
    const rendered = renderTeachingDepthPolicy(context({ fixedImportance: 'key' }));
    expect(rendered).toContain('【教学深模块｜重点】');
    expect(rendered).toContain('边界和适用条件');
    expect(rendered).toContain('反例');
    expect(rendered).toContain('典型误区');
    expect(rendered).toContain('多轮互动');
  });

  it('combines fixed importance and adaptive difficulty without losing either strategy', () => {
    const rendered = renderTeachingDepthPolicy(
      context({ fixedImportance: 'key', adaptiveDifficulty: 'difficult' }),
    );
    expect(rendered).toContain('【教学深模块｜重难点】');
    expect(rendered).toContain('边界和适用条件');
    expect(rendered).toContain('学习者已经出现的错误、误解、不解或深入讲解需求');
    expect(rendered).toContain('更换例子、类比、反例、图形或推理路径');
  });
});
