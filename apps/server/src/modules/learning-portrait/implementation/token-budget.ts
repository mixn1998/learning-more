import type { CandidateEvidence } from '../../profile-evidence/interface.js';

export const TOKEN_ESTIMATOR_VERSION = 'conservative-char-estimator@1';

export function estimateEvidenceTokens(evidence: CandidateEvidence): number {
  const textLength =
    evidence.summary.length +
    evidence.strength.rationale.length +
    evidence.sourceRefs.reduce((total, ref) => total + ref.length, 0);
  return 12 + Math.ceil(textLength / 4);
}
