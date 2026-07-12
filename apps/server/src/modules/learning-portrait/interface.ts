export type EvidenceExclusionReason =
  'retracted' | 'superseded' | 'insufficient_composite_support' | 'budget_exceeded';

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
