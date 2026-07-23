import { createHash } from 'node:crypto';

import type { ReasoningDimensionDefinition } from '@learning-more/contracts';

import type { ReasoningDimensionDraft } from '../ports/reasoning-behavior-analyzer.js';

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function normalized(value: string): string {
  return value.trim().normalize('NFKC').toLocaleLowerCase('en-US');
}

function signals(
  input: Pick<ReasoningDimensionDraft, 'inclusionSignals' | 'exclusionSignals'>,
): Set<string> {
  return new Set([...input.inclusionSignals, ...input.exclusionSignals].map(normalized));
}

function overlap(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  const shared = [...left].filter((signal) => right.has(signal)).length;
  return shared / Math.min(left.size, right.size);
}

export function reasoningDimensionFingerprint(
  input: Pick<ReasoningDimensionDraft, 'label' | 'inclusionSignals' | 'exclusionSignals'>,
): string {
  return sha256(
    JSON.stringify({
      label: normalized(input.label),
      inclusionSignals: [...new Set(input.inclusionSignals.map(normalized))].sort(),
      exclusionSignals: [...new Set(input.exclusionSignals.map(normalized))].sort(),
    }),
  );
}

export type ReconciledReasoningDimension = Readonly<{
  draft: ReasoningDimensionDraft;
  dimensionId: string;
  semanticFingerprint: string;
  continuesDimensionId?: string;
  supersedesDimensionIds: readonly string[];
}>;

/**
 * Carries a dynamic dimension forward only when the evidence signals overlap.
 * It deliberately has no fixed vocabulary: a new evidence pattern gets a new lineage.
 */
export function reconcileReasoningDimensions(input: {
  drafts: readonly ReasoningDimensionDraft[];
  activeDimensions: readonly ReasoningDimensionDefinition[];
}): readonly ReconciledReasoningDimension[] {
  const available = [...input.activeDimensions]
    .filter((dimension) => dimension.status === 'active')
    .sort((left, right) => left.dimensionId.localeCompare(right.dimensionId));
  return input.drafts.map((draft) => {
    const draftSignals = signals(draft);
    const matching = available.find(
      (dimension) =>
        normalized(dimension.label) === normalized(draft.label) ||
        overlap(draftSignals, signals(dimension)) >= 0.5,
    );
    const semanticFingerprint = reasoningDimensionFingerprint(draft);
    if (matching === undefined) {
      return {
        draft,
        dimensionId: `reasoning_dimension_${sha256(semanticFingerprint).slice(0, 40)}`,
        semanticFingerprint,
        supersedesDimensionIds: [],
      };
    }
    const lineageId = matching.continuesDimensionId ?? matching.dimensionId;
    return {
      draft,
      dimensionId: lineageId,
      semanticFingerprint,
      ...(matching.dimensionId === lineageId ? {} : { continuesDimensionId: lineageId }),
      supersedesDimensionIds: matching.dimensionId === lineageId ? [] : [matching.dimensionId],
    };
  });
}
