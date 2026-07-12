import type { DataKey } from '@learning-more/contracts';

export type ProfileWindow = Readonly<{ from: string; to: string }>;
export type Fraction = Readonly<{ numerator: number; denominator: number }>;

export type GlobalLearningProfile = Readonly<{
  profileSchemaVersion: number;
  metricDefinitionVersion: number;
  timezone: string;
  window: ProfileWindow;
  asOfFactId?: string;
  learningVolume: Readonly<{
    actualSeconds: number;
    completedLessonCount: number;
    dataKeys: readonly DataKey[];
    sourceCount: number;
    asOfFactId?: string;
  }>;
  lifecycle: Readonly<{
    completedCount: number;
    abandonedCount: number;
    restoredCount: number;
    completionFraction: Fraction;
    dataKeys: readonly DataKey[];
    sourceCount: number;
    asOfFactId?: string;
  }>;
  reviewReflection: Readonly<{
    finalizedReviewCount: number;
    dataKeys: readonly DataKey[];
    sourceCount: number;
    asOfFactId?: string;
  }>;
  planning: Readonly<{
    confirmedScheduleCount: number;
    dataKeys: readonly DataKey[];
    sourceCount: number;
    asOfFactId?: string;
  }>;
  topicCoverage: Readonly<{
    topics: readonly Readonly<{ topic: string; completedLessonCount: number }>[];
    dataKeys: readonly DataKey[];
    sourceCount: number;
    asOfFactId?: string;
  }>;
  dailySeries: readonly Readonly<{
    localDate: string;
    actualSeconds: number;
    completedLessonCount: number;
  }>[];
  sufficiency: Readonly<{
    status: 'insufficient' | 'limited' | 'sufficient';
    activeEvidenceCount: number;
    historicalEvidenceCount: number;
    independentSourceGroupCount: number;
    sourceCategoryCount: number;
    asOfEvidenceId?: string;
  }>;
  observedRange?: Readonly<{ first: string; last: string }>;
  profileChecksum: string;
}>;

export function validateProfileWindow(window: ProfileWindow): void {
  const from = Date.parse(window.from);
  const to = Date.parse(window.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) {
    throw new Error('global_profile_window_invalid');
  }
}
