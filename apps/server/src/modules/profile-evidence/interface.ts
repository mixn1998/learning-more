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
