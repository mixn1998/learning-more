import type { LessonLearning } from '../../modules/learning-session/model/learning-session.js';

export function isTeachingSessionRecoveryEligible(learning: LessonLearning): boolean {
  return (
    learning.progress === 'in_progress' &&
    (learning.session?.state === 'active' || learning.session?.state === 'paused')
  );
}
