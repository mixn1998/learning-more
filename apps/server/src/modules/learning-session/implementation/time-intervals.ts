export type LearningTimeInterval = Readonly<{
  id: string;
  sessionId: string;
  startedAt: string;
  endedAt?: string;
  endReason?:
    'paused' | 'hidden' | 'lease_lost' | 'ai_generation' | 'abandoned' | 'completed' | 'recovered';
  recovered: boolean;
}>;

export function openLearningInterval(
  intervals: readonly LearningTimeInterval[],
  input: { id: string; sessionId: string; now: Date },
): readonly LearningTimeInterval[] {
  if (intervals.some((interval) => interval.endedAt === undefined)) return intervals;
  return [
    ...intervals,
    {
      id: input.id,
      sessionId: input.sessionId,
      startedAt: input.now.toISOString(),
      recovered: false,
    },
  ];
}

export function closeLearningIntervals(
  intervals: readonly LearningTimeInterval[],
  now: Date,
  reason: NonNullable<LearningTimeInterval['endReason']>,
): readonly LearningTimeInterval[] {
  return intervals.map((interval) =>
    interval.endedAt === undefined
      ? { ...interval, endedAt: now.toISOString(), endReason: reason }
      : interval,
  );
}

export function actualLearningSeconds(intervals: readonly LearningTimeInterval[]): number {
  return Math.floor(
    intervals.reduce((total, interval) => {
      if (interval.endedAt === undefined) return total;
      return total + (Date.parse(interval.endedAt) - Date.parse(interval.startedAt));
    }, 0) / 1_000,
  );
}

export function recoverOpenIntervals(
  intervals: readonly LearningTimeInterval[],
  lastHeartbeatAt: Date,
): readonly LearningTimeInterval[] {
  return intervals.map((interval) =>
    interval.endedAt === undefined
      ? {
          ...interval,
          endedAt: lastHeartbeatAt.toISOString(),
          endReason: 'recovered' as const,
          recovered: true,
        }
      : interval,
  );
}
