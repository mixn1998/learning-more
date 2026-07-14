import { createHash } from 'node:crypto';

import type {
  ReasoningBehaviorAnalysisRecord,
  ReasoningBehaviorEpisodeSource,
} from '../../global-user-profile/interface.js';
import type { UnitOfWork } from '../../../persistence/unit-of-work.js';
import type { EvidenceRepositories } from '../ports/evidence-repository.js';
import { parseCandidateEvidence } from './candidate-evidence.js';

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function dimensionKey(dimension: {
  dimensionId: string;
  continuesDimensionId?: string | undefined;
}): string {
  const lineageId = dimension.continuesDimensionId ?? dimension.dimensionId;
  const normalized = lineageId
    .trim()
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, '_')
    .replaceAll(/^_+|_+$/gu, '');
  return `thinking_tendency.${normalized || `dimension_${sha256(lineageId).slice(0, 20)}`}`;
}

export function createReasoningEvidenceProjector(options: {
  reasoningRepository: ReasoningBehaviorEpisodeSource;
  evidenceRepositories: EvidenceRepositories;
  unitOfWork: UnitOfWork;
  now(): Date;
  nextTransactionId(): string;
}) {
  return {
    async project(analysis: ReasoningBehaviorAnalysisRecord): Promise<{ created: number }> {
      const dimensionById = new Map(
        analysis.dimensions.map((dimension) => [dimension.dimensionId, dimension]),
      );
      let created = 0;
      for (const classification of analysis.classifications) {
        if (classification.status !== 'active') continue;
        const episode = await options.reasoningRepository.getEpisode(classification.episodeId);
        if (episode === undefined || episode.status !== 'active') continue;
        const sourceRefs = episode.sourceRefs.filter((ref) =>
          /^(fact|message|review|course-review|outline|supplementary):/u.test(ref),
        );
        for (const label of classification.labels) {
          const dimension = dimensionById.get(label.dimensionId);
          if (dimension === undefined) continue;
          const claimDimension = dimensionKey(dimension);
          const dedupKey = sha256(
            JSON.stringify({
              episodeId: episode.episodeId,
              claimDimension,
            }),
          );
          if (
            (await options.evidenceRepositories.evidence.findByDedupKey(dedupKey)) !== undefined
          ) {
            continue;
          }
          const score: 1 | 2 | 3 = label.confidence >= 0.8 ? 3 : label.confidence >= 0.55 ? 2 : 1;
          const evidence = parseCandidateEvidence(
            {
              evidenceId: `evidence_reasoning_${dedupKey.slice(0, 40)}`,
              claimDimension,
              summary: `${dimension.label}：${label.rationale}`,
              sourceGroup: 'behavior',
              sourceGroupId: episode.sourceGroupId,
              dependentSourceGroupIds: [],
              sourceRefs: sourceRefs.length === 0 ? [`message:${episode.episodeId}`] : sourceRefs,
              dataKeys: [
                'user_profile.reasoning_classification.dimension_ids',
                'user_profile.reasoning_classification.confidence',
                'user_profile.reasoning_episode.source_refs',
              ],
              observedAt: episode.observedAt,
              strength: {
                score,
                rationale: `AI 分类置信度为 ${label.confidence.toFixed(2)}，仍需结合重复行为证据解释。`,
              },
              polarity: 'supporting',
              extractorVersion: `${classification.analyzerVersion}:reasoning-evidence@1`,
              dedupKey,
              status: 'active',
              resourceVersion: 0,
            },
            options.now(),
          );
          await options.unitOfWork.execute({ transactionId: options.nextTransactionId() }, (tx) =>
            options.evidenceRepositories.evidence.save(tx, evidence, 0),
          );
          created += 1;
        }
      }
      return { created };
    },
  };
}
