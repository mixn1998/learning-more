import { describe, expect, it } from 'vitest';

import { renderTeachingPersonalizationPrompt } from '../implementation/teaching-personalization-prompt.js';

function view(signals: Parameters<typeof renderTeachingPersonalizationPrompt>[0]['signals']) {
  return {
    profileVersion: 2,
    purpose: 'interactive_teaching' as const,
    courseId: 'course_1',
    lessonId: 'lesson_1',
    signals,
    completeness: 'limited' as const,
    sourceSnapshotHash: '1'.repeat(64),
    createdAt: '2026-07-21T00:00:00.000Z',
  };
}

describe('renderTeachingPersonalizationPrompt', () => {
  it('deduplicates and groups the existing read-only view without promoting observations', () => {
    const rendered = renderTeachingPersonalizationPrompt(
      view([
        {
          evidenceId: 'a',
          summary: '希望用反例解释。',
          explicitness: 'user_declared',
          sourceRefs: ['message:a'],
          limitations: [],
        },
        {
          evidenceId: 'b',
          summary: '希望用反例解释',
          explicitness: 'user_declared',
          sourceRefs: ['message:b'],
          limitations: [],
        },
        {
          evidenceId: 'c',
          summary: '经常先比较条件再修正判断',
          explicitness: 'ai_observed',
          sourceRefs: ['session:1', 'session:2'],
          limitations: ['不得视为人格事实'],
        },
      ]),
    ).join('\n');
    expect(rendered.match(/希望用反例解释/gu)).toHaveLength(1);
    expect(rendered).toContain('只读压缩投影');
    expect(rendered).toContain('需在当前互动中验证');
    expect(rendered).toContain('不得据此断言能力、人格或当前掌握状态');
  });

  it('does not mechanically truncate an already compressed semantic projection', () => {
    const rendered = renderTeachingPersonalizationPrompt(
      view(
        Array.from({ length: 20 }, (_, index) => ({
          evidenceId: `evidence_${index}`,
          summary: `${index}-${'很长的抽象维度'.repeat(20)}`,
          explicitness: 'ai_observed' as const,
          sourceRefs: [`session:${index}`],
          limitations: [],
        })),
      ),
    ).join('\n');
    expect(rendered).toContain('19-');
    expect(rendered).not.toContain('…');
  });
});
