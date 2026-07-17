import {
  isGlobalProfileEvidence,
  type CandidateEvidence,
} from '../../profile-evidence/interface.js';
import type { EvidenceExclusionReason, PackedPortraitEvidence } from '../interface.js';
import {
  EVIDENCE_POLICY_VERSION,
  compositeSourceCount,
  independentSourceKey,
  isCompositeEligible,
} from './evidence-policy.js';
import { estimateEvidenceTokens, TOKEN_ESTIMATOR_VERSION } from './token-budget.js';

function priorityOf(dimension: string, priorities: readonly string[]): number {
  const index = priorities.indexOf(dimension);
  return index === -1 ? priorities.length : index;
}

function compareEvidence(
  left: CandidateEvidence,
  right: CandidateEvidence,
  priorities: readonly string[],
): number {
  const dimensionPriority =
    priorityOf(left.claimDimension, priorities) - priorityOf(right.claimDimension, priorities);
  if (dimensionPriority !== 0) return dimensionPriority;
  if (left.claimDimension !== right.claimDimension) {
    return left.claimDimension.localeCompare(right.claimDimension);
  }
  if (left.strength.score !== right.strength.score) {
    return right.strength.score - left.strength.score;
  }
  if (left.observedAt !== right.observedAt) return right.observedAt.localeCompare(left.observedAt);
  return left.evidenceId.localeCompare(right.evidenceId);
}

export function packPortraitEvidence(input: {
  evidence: readonly CandidateEvidence[];
  tokenBudget: number;
  dimensionPriority: readonly string[];
}): PackedPortraitEvidence {
  if (!Number.isInteger(input.tokenBudget) || input.tokenBudget < 0) {
    throw new RangeError('portrait_token_budget_invalid');
  }
  const latest = new Map<string, CandidateEvidence>();
  for (const candidate of input.evidence) {
    const current = latest.get(candidate.evidenceId);
    if (current === undefined || candidate.resourceVersion >= current.resourceVersion) {
      latest.set(candidate.evidenceId, candidate);
    }
  }
  const exclusions = new Map<string, EvidenceExclusionReason>();
  const active: CandidateEvidence[] = [];
  for (const candidate of latest.values()) {
    if (candidate.status === 'retracted') exclusions.set(candidate.evidenceId, 'retracted');
    else if (candidate.status === 'superseded') exclusions.set(candidate.evidenceId, 'superseded');
    else if (!isGlobalProfileEvidence(candidate)) {
      exclusions.set(candidate.evidenceId, 'not_global_profile_evidence');
    } else active.push(candidate);
  }
  const dimensions = new Map<string, CandidateEvidence[]>();
  for (const candidate of active) {
    const group = dimensions.get(candidate.claimDimension) ?? [];
    group.push(candidate);
    dimensions.set(candidate.claimDimension, group);
  }
  const dimensionNames = [...dimensions.keys()].sort((left, right) => {
    const priority =
      priorityOf(left, input.dimensionPriority) - priorityOf(right, input.dimensionPriority);
    return priority === 0 ? left.localeCompare(right) : priority;
  });
  const eligibleDimensions: string[] = [];
  for (const dimension of dimensionNames) {
    const candidates = dimensions.get(dimension)!;
    if (isCompositeEligible(candidates)) eligibleDimensions.push(dimension);
    else {
      for (const candidate of candidates) {
        exclusions.set(candidate.evidenceId, 'insufficient_composite_support');
      }
    }
  }

  const included = new Map<string, CandidateEvidence>();
  let estimatedTokens = 0;
  for (const dimension of eligibleDimensions) {
    const candidates = [...dimensions.get(dimension)!].sort((left, right) =>
      compareEvidence(left, right, input.dimensionPriority),
    );
    const seenSources = new Set<string>();
    const seed: CandidateEvidence[] = [];
    for (const candidate of candidates) {
      const source = independentSourceKey(candidate);
      if (seenSources.has(source)) continue;
      seenSources.add(source);
      seed.push(candidate);
      if (seed.length === 2) break;
    }
    const seedCost = seed.reduce(
      (total, candidate) => total + estimateEvidenceTokens(candidate),
      0,
    );
    if (estimatedTokens + seedCost > input.tokenBudget) {
      for (const candidate of candidates) exclusions.set(candidate.evidenceId, 'budget_exceeded');
      continue;
    }
    for (const candidate of seed) included.set(candidate.evidenceId, candidate);
    estimatedTokens += seedCost;
  }

  const extras = eligibleDimensions
    .flatMap((dimension) => dimensions.get(dimension)!)
    .filter((candidate) => !included.has(candidate.evidenceId))
    .sort((left, right) => compareEvidence(left, right, input.dimensionPriority));
  for (const candidate of extras) {
    if (exclusions.has(candidate.evidenceId)) continue;
    const cost = estimateEvidenceTokens(candidate);
    if (estimatedTokens + cost <= input.tokenBudget) {
      included.set(candidate.evidenceId, candidate);
      estimatedTokens += cost;
    } else exclusions.set(candidate.evidenceId, 'budget_exceeded');
  }

  const ordered = [...included.values()].sort((left, right) =>
    compareEvidence(left, right, input.dimensionPriority),
  );
  return {
    includedEvidenceIds: ordered.map((candidate) => candidate.evidenceId),
    excluded: [...exclusions.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([evidenceId, reason]) => ({ evidenceId, reason })),
    dimensionCoverage: dimensionNames.map((dimension) => {
      const candidates = dimensions.get(dimension)!;
      return {
        dimension,
        includedCount: candidates.filter((candidate) => included.has(candidate.evidenceId)).length,
        independentSourceGroupCount: compositeSourceCount(candidates),
        compositeEligible: isCompositeEligible(candidates),
      };
    }),
    sourceGroupCoverage: [...new Set(ordered.map(independentSourceKey))].sort(),
    estimatedTokens,
    tokenBudget: input.tokenBudget,
    policyVersion: EVIDENCE_POLICY_VERSION,
    tokenEstimatorVersion: TOKEN_ESTIMATOR_VERSION,
  };
}
