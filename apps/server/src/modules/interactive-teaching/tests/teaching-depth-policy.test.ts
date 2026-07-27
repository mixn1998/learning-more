import { describe, expect, it } from 'vitest';

import { renderTeachingDepthPolicy } from '../implementation/teaching-depth-policy.js';
import { createTeachingState } from '../implementation/teaching-state-reducer.js';
import type { TeachingContextPackage } from '../ports/teaching-context-sources.js';

function context(input: {
  fixedImportance?: 'normal' | 'key';
  adaptiveDifficulty?: 'normal' | 'difficult';
  depthPreference?: 'default' | 'condensed';
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
        depthPreference: input.depthPreference ?? 'default',
      })),
    },
    recentMessages: [],
    unobservedMessages: [],
  };
}

describe('teaching depth policy', () => {
  it('provides only a depth signal for a normal knowledge point', () => {
    const rendered = renderTeachingDepthPolicy(context({}));
    expect(rendered).toContain('【教学深模块｜普通知识点】');
    expect(rendered).toContain('不规定固定讲解或互动方式');
    expect(rendered?.split('\n')).toHaveLength(3);
  });

  it('marks fixed key points without adding content-generation tactics', () => {
    const rendered = renderTeachingDepthPolicy(context({ fixedImportance: 'key' }));
    expect(rendered).toContain('【教学深模块｜重点】');
    expect(rendered).toContain('不规定固定讲解或互动方式');
    expect(rendered).not.toContain('综合问题');
    expect(rendered).not.toContain('最多追问一次');
    expect(rendered).not.toContain('反例');
  });

  it('combines fixed importance and adaptive difficulty as one signal', () => {
    const rendered = renderTeachingDepthPolicy(
      context({ fixedImportance: 'key', adaptiveDifficulty: 'difficult' }),
    );
    expect(rendered).toContain('【教学深模块｜重难点】');
    expect(rendered).not.toContain('更换例子、类比、反例、图形或推理路径');
    expect(rendered?.split('\n')).toHaveLength(3);
  });

  it('downgrades a fixed key point for the current session when the learner requests brevity', () => {
    const rendered = renderTeachingDepthPolicy(
      context({ fixedImportance: 'key', depthPreference: 'condensed' }),
    );
    expect(rendered).toContain('【教学深模块｜普通知识点】');
    expect(rendered).not.toContain('典型误区');
  });
});
