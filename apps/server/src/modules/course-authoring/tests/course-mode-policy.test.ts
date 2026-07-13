import { COURSE_MODES } from '@learning-more/contracts';
import { describe, expect, it } from 'vitest';

import { buildCourseModeContext, courseModeIntents } from '../implementation/course-mode-policy.js';

describe('course mode policy', () => {
  it('[EQ-PLAY-05] gives every play shell its own intent without reusing another mode rule', () => {
    const intents = Object.values(courseModeIntents());
    expect(intents).toHaveLength(COURSE_MODES.length);
    expect(new Set(intents).size).toBe(COURSE_MODES.length);
  });

  it('[EQ-PLAY-04] keeps structure free instead of mapping a mode to fixed stages or lesson types', () => {
    const first = buildCourseModeContext('case_study', '分布式一致性');
    const second = buildCourseModeContext('case_study', '品牌定价');

    expect(first.topic).not.toBe(second.topic);
    expect(first.freedoms).toEqual([
      'module-count',
      'stage-count',
      'lesson-types',
      'review-organization',
    ]);
    expect(first).not.toHaveProperty('recommendedMethod');
    expect(first).not.toHaveProperty('lessonTemplate');
  });
});
