import { createHash } from 'node:crypto';

import type {
  ReasoningBehaviorAnalysisRecord,
  ReasoningBehaviorEpisodeSource,
} from '../../global-user-profile/interface.js';
import type { UnitOfWork } from '../../../persistence/unit-of-work.js';
import type { CandidateEvidence } from '../interface.js';
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

function sessionSourceGroupId(sessionId: string): string {
  return `session:${sessionId}`;
}

function validSourceRefs(sourceRefs: readonly string[]): string[] {
  return sourceRefs.filter((ref) =>
    /^(fact|message|review|course-review|outline|supplementary):/u.test(ref),
  );
}

function isDeprecatedBehaviorEvidence(candidate: CandidateEvidence): boolean {
  return (
    candidate.status === 'active' &&
    (candidate.sourceFactType === 'LessonPausedFact' ||
      candidate.claimDimension === 'learning.session_regulation' ||
      candidate.extractorVersion.endsWith(':reasoning-evidence@1'))
  );
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
      const deprecated: CandidateEvidence[] = [];
      for await (const candidate of options.evidenceRepositories.evidence.list()) {
        if (isDeprecatedBehaviorEvidence(candidate)) deprecated.push(candidate);
      }
      if (deprecated.length > 0) {
        await options.unitOfWork.execute(
          { transactionId: options.nextTransactionId() },
          async (tx) => {
            for (const candidate of deprecated) {
              await options.evidenceRepositories.evidence.save(
                tx,
                { ...candidate, status: 'retracted' },
                candidate.resourceVersion,
              );
            }
          },
        );
      }

      const dimensionById = new Map(
        analysis.dimensions.map((dimension) => [dimension.dimensionId, dimension]),
      );
      const groups = new Map<
        string,
        {
          claimDimension: string;
          dimension: (typeof analysis.dimensions)[number];
          sourceGroupId: string;
          sourceRefs: Set<string>;
          observedAt: string;
          confidences: number[];
          episodeIds: Set<string>;
        }
      >();

      for (const classification of analysis.classifications) {
        if (classification.status !== 'active') continue;
        const episode = await options.reasoningRepository.getEpisode(classification.episodeId);
        if (episode === undefined || episode.status !== 'active') continue;
        const sourceGroupId = sessionSourceGroupId(episode.sessionId);
        const refs = validSourceRefs(episode.sourceRefs);
        for (const label of classification.labels) {
          const dimension = dimensionById.get(label.dimensionId);
          if (dimension === undefined) continue;
          const claimDimension = dimensionKey(dimension);
          const key = `${sourceGroupId}\u0000${claimDimension}`;
          const group = groups.get(key) ?? {
            claimDimension,
            dimension,
            sourceGroupId,
            sourceRefs: new Set<string>(),
            observedAt: episode.observedAt,
            confidences: [],
            episodeIds: new Set<string>(),
          };
          for (const ref of refs.length === 0 ? [`message:${episode.episodeId}`] : refs) {
            group.sourceRefs.add(ref);
          }
          if (episode.observedAt > group.observedAt) group.observedAt = episode.observedAt;
          group.confidences.push(label.confidence);
          group.episodeIds.add(episode.episodeId);
          groups.set(key, group);
        }
      }

      let created = 0;
      for (const group of [...groups.values()].sort((left, right) =>
        `${left.claimDimension}:${left.sourceGroupId}`.localeCompare(
          `${right.claimDimension}:${right.sourceGroupId}`,
        ),
      )) {
        const dedupKey = sha256(
          JSON.stringify({
            sourceGroupId: group.sourceGroupId,
            claimDimension: group.claimDimension,
            projection: 'reasoning-session-dimension@2',
          }),
        );
        const existing = await options.evidenceRepositories.evidence.findByDedupKey(dedupKey);
        const confidence = Math.max(...group.confidences);
        const score: 1 | 2 | 3 = confidence >= 0.8 ? 3 : confidence >= 0.55 ? 2 : 1;
        const evidence = parseCandidateEvidence(
          {
            evidenceId: existing?.evidenceId ?? `evidence_reasoning_${dedupKey.slice(0, 40)}`,
            claimDimension: group.claimDimension,
            summary: `${group.dimension.label}：${group.dimension.description}`,
            sourceGroup: 'behavior',
            sourceGroupId: group.sourceGroupId,
            dependentSourceGroupIds: [],
            sourceRefs: [...group.sourceRefs].sort(),
            dataKeys: [
              'user_profile.reasoning_classification.dimension_ids',
              'user_profile.reasoning_classification.confidence',
              'user_profile.reasoning_episode.source_refs',
            ],
            observedAt: group.observedAt,
            strength: {
              score,
              rationale: `该全局抽象维度在本次独立学习会话的 ${group.episodeIds.size} 条原始行为观察中得到支持；会话内重复不增加独立来源数。`,
            },
            polarity: 'supporting',
            extractorVersion: `${analysis.snapshot.analyzerVersion}:reasoning-session-dimension@2`,
            dedupKey,
            status: 'active',
            resourceVersion: existing?.resourceVersion ?? 0,
          },
          options.now(),
        );
        await options.unitOfWork.execute({ transactionId: options.nextTransactionId() }, (tx) =>
          options.evidenceRepositories.evidence.save(tx, evidence, existing?.resourceVersion ?? 0),
        );
        if (existing === undefined) created += 1;
      }
      return { created };
    },
  };
}
