import { describe, expect, it } from 'vitest';

import { projectSemanticText } from '../implementation/semantic-context-projection.js';

describe('semantic context projection', () => {
  it('selects complete decision units instead of cutting text at a character boundary', () => {
    const source = [
      '背景材料展开很长但不改变当前决定。',
      '必须保留已经开始的课节。',
      '必须保留已经开始的课节。',
      '需要重构尚未开始课节的因果链。',
      '不要改变已完成模块的归属。',
    ].join('');

    const projected = projectSemanticText(source, 35);
    const projectedUnits = projected.split(' ').filter(Boolean);

    expect(projected.length).toBeLessThanOrEqual(35);
    expect(projectedUnits.length).toBeGreaterThan(0);
    expect(new Set(projectedUnits).size).toBe(projectedUnits.length);
    for (const unit of projectedUnits) {
      expect(source).toContain(unit);
      expect(unit).toMatch(/[。！？!?；;，,：:]$/u);
    }
  });
});
