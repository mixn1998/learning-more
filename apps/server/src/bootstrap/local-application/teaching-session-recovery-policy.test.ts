import { describe, expect, it } from 'vitest';

import type { LessonLearning } from '../../modules/learning-session/model/learning-session.js';
import { isTeachingSessionRecoveryEligible } from './teaching-session-recovery-policy.js';

function learning(
  progress: LessonLearning['progress'],
  state?: NonNullable<LessonLearning['session']>['state'],
): LessonLearning {
  return {
    lessonId: 'lesson_01',
    progress,
    processedCommandIds: [],
    ...(state === undefined
      ? {}
      : {
          session: {
            id: 'session_01',
            state,
            messageIds: [],
            evidenceCheckpoint: false,
          },
        }),
  };
}

describe('teaching session recovery policy', () => {
  it.each([
    ['active', learning('in_progress', 'active')],
    ['paused', learning('in_progress', 'paused')],
  ] as const)('recovers an in-progress %s session', (_label, candidate) => {
    expect(isTeachingSessionRecoveryEligible(candidate)).toBe(true);
  });

  it.each([
    ['not started', learning('not_started')],
    ['abandoned', learning('abandoned', 'frozen')],
    ['completed', learning('completed', 'closed')],
    ['frozen in progress', learning('in_progress', 'frozen')],
    ['closed in progress', learning('in_progress', 'closed')],
  ] as const)('does not recover a %s lesson', (_label, candidate) => {
    expect(isTeachingSessionRecoveryEligible(candidate)).toBe(false);
  });
});
