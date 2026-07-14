import { describe, expect, it } from 'vitest';

import type { NextLessonCandidate } from '../interface.js';
import { eligibleNextLessons } from '../implementation/eligible-lessons.js';

function candidate(
  semanticKey: string,
  overrides: Partial<NextLessonCandidate> = {},
): NextLessonCandidate {
  return {
    semanticKey,
    title: semanticKey,
    objective: semanticKey,
    prerequisiteSemanticKeys: [],
    estimatedMinutes: 20,
    progress: 'not_started',
    courseStatus: 'active',
    available: true,
    activeSession: false,
    evidenceRefs: [],
    ...overrides,
  };
}

describe('eligibleNextLessons', () => {
  it('filters unmet prerequisites, completion, abandonment, closed courses, unavailable lessons, and active sessions', () => {
    const eligible = candidate('eligible', { prerequisiteSemanticKeys: ['foundation'] });
    expect(
      eligibleNextLessons(
        [
          eligible,
          candidate('unmet', { prerequisiteSemanticKeys: ['missing'] }),
          candidate('completed', { progress: 'completed' }),
          candidate('abandoned', { progress: 'abandoned' }),
          candidate('archived', { courseStatus: 'closed' }),
          candidate('unavailable', { available: false }),
          candidate('active', { progress: 'in_progress', activeSession: true }),
        ],
        ['foundation'],
      ),
    ).toEqual([eligible]);
  });
});
