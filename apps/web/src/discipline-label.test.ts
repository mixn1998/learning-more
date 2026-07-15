import { describe, expect, it } from 'vitest';

import { toBroadDisciplineLabel } from './discipline-label.js';

describe('toBroadDisciplineLabel', () => {
  it('normalizes the current detailed historical tags to broad disciplines', () => {
    expect(toBroadDisciplineLabel('AI 商业分析与创业')).toBe('商业');
    expect(toBroadDisciplineLabel('数学·单变量微积分与证明基础')).toBe('数学');
  });

  it('preserves an already broad or unknown historical label', () => {
    expect(toBroadDisciplineLabel('商业')).toBe('商业');
    expect(toBroadDisciplineLabel('产品设计')).toBe('产品设计');
    expect(toBroadDisciplineLabel(undefined)).toBeUndefined();
  });
});
