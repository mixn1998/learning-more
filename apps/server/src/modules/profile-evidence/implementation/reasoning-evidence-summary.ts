import type { ReasoningBehaviorEpisode } from '@learning-more/contracts';

import { isGlobalReasoningDimensionEvidence, type CandidateEvidence } from '../interface.js';

function distinctNonEmpty(values: readonly string[]): string[] {
  return values
    .map((value) => value.trim())
    .filter(
      (value, index, all) => value !== '' && all.findIndex((item) => item === value) === index,
    );
}

function withoutTerminalPunctuation(value: string): string {
  return value.replace(/[。.!?！？；;]+$/u, '');
}

export function combineReasoningBehaviorSummaries(
  summaries: readonly string[],
  fallback: string,
): string {
  const distinct = distinctNonEmpty(summaries);
  if (distinct.length === 0) return fallback.trim();
  if (distinct.length === 1) return distinct[0]!;
  return distinct
    .map((summary, index) =>
      index === distinct.length - 1 ? summary : withoutTerminalPunctuation(summary),
    )
    .join('；');
}

export function reasoningEvidenceSummaryForRead(
  evidence: CandidateEvidence,
  episodes: readonly ReasoningBehaviorEpisode[],
): string {
  if (!isGlobalReasoningDimensionEvidence(evidence)) return evidence.summary;
  const match = /^session:(.+)$/u.exec(evidence.sourceGroupId);
  if (match === null) return evidence.summary;
  const sessionId = match[1]!;
  const sourceRefs = new Set(evidence.sourceRefs);
  const summaries = episodes
    .filter(
      (episode) =>
        episode.status === 'active' &&
        episode.sessionId === sessionId &&
        episode.sourceRefs.some((sourceRef) => sourceRefs.has(sourceRef)),
    )
    .map((episode) => episode.behaviorSummary);
  return combineReasoningBehaviorSummaries(summaries, evidence.summary);
}
