import type { LearningTimeInterval } from '../modules/learning-session/implementation/time-intervals.js';

export function latestLearningActivityAt(
  intervals: readonly LearningTimeInterval[],
): string | undefined {
  return intervals
    .map((interval) => interval.endedAt ?? interval.startedAt)
    .sort((left, right) => right.localeCompare(left))[0];
}
