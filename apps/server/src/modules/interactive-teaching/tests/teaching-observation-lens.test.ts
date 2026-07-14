import { describe, expect, it } from 'vitest';

import { teachingObservationLens } from '../implementation/teaching-observation-lens.js';

describe('teachingObservationLens', () => {
  it('turns a course mode into a non-restrictive observation priority', () => {
    const lens = teachingObservationLens('case_study');

    expect(lens.priority).toContain('情境');
    expect(lens.nonRequirements).toContain('不要求每一轮都体现该观察重心。');
    expect(lens.nonRequirements).toContain('不能因为不符合该重心而忽略其他有证据支持的学习行为。');
  });

  it('keeps standard mode neutral while retaining the same evidence safeguards', () => {
    const lens = teachingObservationLens('standard');

    expect(lens.priority).toContain('当前知识点');
    expect(lens.nonRequirements).toContain(
      '不能把玩法偏好或局部表现写成稳定能力、人格或固定思维类型。',
    );
  });
});
