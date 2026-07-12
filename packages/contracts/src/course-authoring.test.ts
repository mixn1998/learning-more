import { describe, expect, it } from 'vitest';

import {
  COURSE_MODES,
  CreateOutlineSessionBodySchema,
  RequestCandidateGenerationBodySchema,
} from './course-authoring.js';

describe('CourseAuthoring transport contracts', () => {
  it('freezes the nine approved course modes', () => {
    expect(COURSE_MODES).toEqual([
      'standard',
      'brainstorm',
      'argument_clash',
      'case_study',
      'business_insight',
      'process_decomposition',
      'decision_analysis',
      'cross_explore',
      'reading_seminar',
    ]);
  });

  it('rejects legacy product dimensions and arbitrary generation input', () => {
    expect(
      CreateOutlineSessionBodySchema.safeParse({
        topic: 'probability theory',
        courseMode: 'standard',
        learnerStage: 'beginner',
      }).success,
    ).toBe(false);
    expect(
      RequestCandidateGenerationBodySchema.safeParse({ prompt: 'private prompt' }).success,
    ).toBe(false);
  });
});
