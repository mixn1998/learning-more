import type { DataKey } from '@learning-more/contracts';

import type { LearningFact, LearningFactType } from '../learning-facts/interface.js';

export type EvidenceSourceGroup = 'behavior' | 'outcome' | 'reflection' | 'planning' | 'review';

export type EvidenceStrength = Readonly<{
  score: 1 | 2 | 3;
  rationale: string;
}>;

export type CandidateEvidence = Readonly<{
  evidenceId: string;
  claimDimension: string;
  summary: string;
  sourceGroup: EvidenceSourceGroup;
  sourceGroupId: string;
  dependentSourceGroupIds: readonly string[];
  sourceFactType?: LearningFactType;
  sourceRefs: readonly string[];
  dataKeys: readonly DataKey[];
  observedAt: string;
  strength: EvidenceStrength;
  polarity: 'supporting' | 'limiting' | 'contradicting';
  extractorVersion: string;
  dedupKey: string;
  status: 'active' | 'superseded' | 'retracted';
  resourceVersion: number;
}>;

export type SourceCheckpoint = Readonly<{
  checkpointId: string;
  sourceGroup: EvidenceSourceGroup;
  lastFactId?: string;
  extractorVersion: string;
  outputChecksum: string;
  processedFactCount: number;
  rejectedFactCount: number;
  updatedAt: string;
  resourceVersion: number;
}>;

export type RejectedEvidenceRecord = Readonly<{
  rejectionId: string;
  factId: string;
  sourceGroup: EvidenceSourceGroup;
  extractorVersion: string;
  errorCode: string;
  rejectedAt: string;
  resourceVersion: number;
}>;

export interface ProfileFactSource {
  list(): AsyncIterable<LearningFact>;
}

export interface ProfileEvidenceSource {
  get(evidenceId: string): Promise<CandidateEvidence | undefined>;
  list(): AsyncIterable<CandidateEvidence>;
}

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
  interaction: Readonly<{
    promptCount: number;
    responseCount: number;
    skipCount: number;
    interactionLessonCount: number;
    responseRate: Fraction;
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
  exclusions: Readonly<{
    outsideWindowFactCount: number;
    retractedEvidenceCount: number;
    supersededEvidenceCount: number;
    telemetryDataKeyCount: number;
  }>;
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
