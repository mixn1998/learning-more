export type EvidenceExclusionReason =
  | 'retracted'
  | 'superseded'
  | 'not_global_profile_evidence'
  | 'insufficient_composite_support'
  | 'budget_exceeded';

export type PackedPortraitEvidence = Readonly<{
  includedEvidenceIds: readonly string[];
  excluded: readonly Readonly<{
    evidenceId: string;
    reason: EvidenceExclusionReason;
  }>[];
  dimensionCoverage: readonly Readonly<{
    dimension: string;
    includedCount: number;
    independentSourceGroupCount: number;
    compositeEligible: boolean;
  }>[];
  sourceGroupCoverage: readonly string[];
  estimatedTokens: number;
  tokenBudget: number;
  policyVersion: string;
  tokenEstimatorVersion: string;
}>;

export type PortraitInputManifest = Readonly<{
  manifestId: string;
  profileVersion: number;
  evidencePackChecksum: string;
  includedEvidenceIds: readonly string[];
  window: Readonly<{ from: string; to: string }>;
  policyVersion: string;
  promptTemplateVersion: string;
  providerConfigFingerprint: string;
  reasoningBehaviorInput?:
    | Readonly<{
        snapshotId: string;
        sourceSnapshotHash: string;
        dimensionSetVersion: string;
      }>
    | undefined;
  manifestChecksum: string;
  createdAt: string;
}>;

export type PortraitClaim = Readonly<{
  claimId: string;
  markdown: string;
  evidenceIds: readonly string[];
  confidence: number;
  limitations: readonly string[];
  counterEvidenceChecked: true;
}>;

export type PortraitVersion = Readonly<{
  versionId: string;
  manifestId: string;
  state: 'preparing' | 'generating' | 'failed' | 'completed';
  generationTaskId?: string;
  title?: string;
  summary?: string;
  claims: readonly PortraitClaim[];
  errorCode?: string;
  draftArtifactRef?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  resourceVersion: number;
}>;

export type PortraitCurrentCursor = Readonly<{
  currentVersionId: string;
  updatedAt: string;
  resourceVersion: number;
}>;

export type PortraitTaskReceipt = Readonly<{
  idempotencyKey: string;
  versionId: string;
  manifestId: string;
  createdAt: string;
}>;

export interface PortraitEvidenceSource {
  get(evidenceId: string): Promise<CandidateEvidence | undefined>;
}
import type { CandidateEvidence } from '../profile-evidence/interface.js';
