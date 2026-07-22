import { describe, expect, it } from 'vitest';

import { teachingPlayIntent } from '../implementation/teaching-play-intent.js';

describe('teaching play intent', () => {
  it('omits an intent for standard teaching', () => {
    expect(teachingPlayIntent('standard')).toBeUndefined();
  });

  it('uses one open learning-experience signal rather than methods or quotas', () => {
    const intent = teachingPlayIntent('case_study');
    expect(intent).toContain('具体情境');
    expect(intent).toContain('面对真实决策的临场感和沉浸感');
    expect(intent).not.toMatch(/必须|每回合|至少|步骤|模板|SWOT|矩阵/u);
  });

  it('keeps every non-standard course mode available through the same contract', () => {
    for (const mode of [
      'brainstorm',
      'argument_clash',
      'case_study',
      'business_insight',
      'process_decomposition',
      'decision_analysis',
      'cross_explore',
      'reading_seminar',
    ] as const) {
      expect(teachingPlayIntent(mode)).toEqual(expect.any(String));
    }
  });
});
