import type { TeachingStateSnapshot } from '@learning-more/contracts';
import { describe, expect, it } from 'vitest';

import { activeKnowledgePointRefForProgress } from './learning-runtime.js';

describe('learning runtime teaching progress projection', () => {
  it('does not restore the first knowledge point after knowledge-point teaching is complete', () => {
    const state = {
      lessonPhase: 'comprehensive_application',
    } as TeachingStateSnapshot;

    expect(activeKnowledgePointRefForProgress(state, 'knowledge:kp_1')).toBeUndefined();
  });

  it('uses the first knowledge point while a new warmup has no persisted active reference', () => {
    expect(activeKnowledgePointRefForProgress(undefined, 'knowledge:kp_1')).toBe('knowledge:kp_1');
  });
});
