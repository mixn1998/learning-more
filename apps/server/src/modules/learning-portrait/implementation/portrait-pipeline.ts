import type { CandidateEvidence, GlobalLearningProfile } from '../../profile-evidence/interface.js';

export function preparePortraitIncrement(
  input: Readonly<{
    profile: GlobalLearningProfile;
    evidence: readonly CandidateEvidence[];
    afterEvidenceId?: string;
    limit: number;
  }>,
): Readonly<{
  profileSnapshot?: GlobalLearningProfile;
  evidence: readonly CandidateEvidence[];
  nextEvidenceCursor?: string;
  backlogCount: number;
}> {
  if (!Number.isInteger(input.limit) || input.limit <= 0) {
    throw new RangeError('portrait_increment_limit_invalid');
  }
  const ordered = [...input.evidence].sort(
    (left, right) =>
      left.observedAt.localeCompare(right.observedAt) ||
      left.evidenceId.localeCompare(right.evidenceId),
  );
  const start =
    input.afterEvidenceId === undefined
      ? 0
      : Math.max(0, ordered.findIndex((item) => item.evidenceId === input.afterEvidenceId) + 1);
  const remaining = ordered.slice(start);
  const selected = remaining.slice(0, input.limit);
  return {
    ...(input.afterEvidenceId === undefined ? { profileSnapshot: input.profile } : {}),
    evidence: selected,
    ...(selected.at(-1) === undefined ? {} : { nextEvidenceCursor: selected.at(-1)!.evidenceId }),
    backlogCount: Math.max(0, remaining.length - selected.length),
  };
}
