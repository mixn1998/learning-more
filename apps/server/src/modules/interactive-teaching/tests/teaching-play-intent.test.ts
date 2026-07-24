import { describe, expect, it } from 'vitest';

import { teachingPlayIntent } from '../implementation/teaching-play-intent.js';

describe('teaching play intent', () => {
  it('keeps standard courses free of a forced play style', () => {
    expect(teachingPlayIntent('standard')).toBeUndefined();
  });

  it('keeps case-study teaching immersive without turning its form into a quota', () => {
    const intent = teachingPlayIntent('case_study');
    expect(intent).toContain('具体情境');
    expect(intent).toContain('临场感和沉浸感');
    expect(intent).not.toMatch(/必须|每回合|至少|步骤|模板|SWOT|矩阵/u);
  });

  it.each([
    'brainstorm',
    'argument_clash',
    'case_study',
    'business_insight',
    'process_decomposition',
    'decision_analysis',
    'cross_explore',
    'reading_seminar',
  ] as const)('adds an explicit language rhythm for %s courses', (mode) => {
    const intent = teachingPlayIntent(mode);
    expect(intent).toContain('表达节奏：');
    expect(intent).not.toContain('统一采用严肃讲授');
  });
});
