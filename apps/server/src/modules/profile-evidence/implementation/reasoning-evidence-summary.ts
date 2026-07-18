import type { ReasoningBehaviorEpisode } from '@learning-more/contracts';

import type { CandidateEvidence } from '../interface.js';

export function reasoningEvidenceSummaryForRead(
  evidence: CandidateEvidence,
  episodes: readonly ReasoningBehaviorEpisode[],
): string {
  void episodes;
  return evidence.summary;
}
