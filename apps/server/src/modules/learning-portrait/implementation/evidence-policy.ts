import type { CandidateEvidence } from '../../profile-evidence/interface.js';

export const EVIDENCE_POLICY_VERSION = 'composite-evidence@1';

export function independentSourceKey(evidence: CandidateEvidence): string {
  return [...evidence.dependentSourceGroupIds].sort()[0] ?? evidence.sourceGroupId;
}

export function compositeSourceCount(evidence: readonly CandidateEvidence[]): number {
  return new Set(evidence.map(independentSourceKey)).size;
}

export function isCompositeEligible(evidence: readonly CandidateEvidence[]): boolean {
  return compositeSourceCount(evidence) >= 2;
}
