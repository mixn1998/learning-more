import { createHash, randomUUID } from 'node:crypto';

import type { AssembledProfileEvidenceContext } from '../../modules/profile-evidence/implementation/profile-evidence-context-assembler.js';
import type {
  EvidenceSourceGroup,
  SourceCheckpoint,
} from '../../modules/profile-evidence/interface.js';
import type { EvidenceRepositories } from '../../modules/profile-evidence/ports/evidence-repository.js';
import type { ReasoningBehaviorRepository } from '../../modules/global-user-profile/ports/reasoning-behavior-repository.js';
import type { UnitOfWork } from '../../persistence/unit-of-work.js';

export const PROFILE_EVIDENCE_EXTRACTOR_VERSION = 'profile-evidence@1';
const REVIEW_SESSION_DIMENSION_EXTRACTOR_VERSION = 'review-session-dimension@1';

function receiptId(checkpointId: string): string {
  const digest = createHash('sha256').update(checkpointId, 'utf8').digest('hex');
  return `profile_evidence_receipt_${digest.slice(0, 40)}`;
}

function receiptSourceGroup(sourceType: unknown): EvidenceSourceGroup {
  if (sourceType === 'review') return 'review';
  if (sourceType === 'lesson') return 'behavior';
  if (sourceType === 'outline') return 'planning';
  return 'reflection';
}

export function createProfileEvidenceCheckpointRecovery(input: {
  reasoning: ReasoningBehaviorRepository;
  evidence: EvidenceRepositories;
  unitOfWork: UnitOfWork;
}) {
  async function enrichReviewCheckpoint(
    checkpoint: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (
      checkpoint.checkpointKind !== 'stage_review_finalized' &&
      checkpoint.checkpointKind !== 'lesson_review_finalized'
    ) {
      return checkpoint;
    }
    const sessionSource = Array.isArray(checkpoint.dependentSourceGroupIds)
      ? checkpoint.dependentSourceGroupIds
          .filter((value): value is string => typeof value === 'string')
          .map((sourceGroupId) => /^lesson:[^:]+:session:(.+)$/u.exec(sourceGroupId))
          .find((match): match is RegExpExecArray => match !== null)
      : undefined;
    if (
      sessionSource === undefined ||
      typeof checkpoint.sourceGroupId !== 'string' ||
      !Array.isArray(checkpoint.sources)
    ) {
      return checkpoint;
    }

    const existingSourceRefs = new Set(
      checkpoint.sources
        .filter(
          (source): source is Record<string, unknown> =>
            typeof source === 'object' && source !== null && !Array.isArray(source),
        )
        .map((source) => source.sourceRef)
        .filter((sourceRef): sourceRef is string => typeof sourceRef === 'string'),
    );
    const episodeSources = new Map<string, { summaries: Set<string>; observedAt: string }>();
    for await (const episode of input.reasoning.listEpisodes()) {
      if (
        episode.status !== 'active' ||
        episode.extractorVersion !== 'reasoning-episode-extractor@1' ||
        episode.sessionId !== sessionSource[1]
      ) {
        continue;
      }
      for (const sourceRef of episode.sourceRefs) {
        if (!sourceRef.startsWith('message:') || existingSourceRefs.has(sourceRef)) continue;
        const current = episodeSources.get(sourceRef);
        if (current === undefined) {
          episodeSources.set(sourceRef, {
            summaries: new Set([episode.behaviorSummary]),
            observedAt: episode.observedAt,
          });
        } else {
          current.summaries.add(episode.behaviorSummary);
          if (episode.observedAt > current.observedAt) current.observedAt = episode.observedAt;
        }
      }
    }
    const remainingCapacity = Math.max(0, 64 - checkpoint.sources.length);
    const sources = [...episodeSources.entries()]
      .sort(([leftRef, left], [rightRef, right]) =>
        left.observedAt === right.observedAt
          ? leftRef.localeCompare(rightRef)
          : left.observedAt.localeCompare(right.observedAt),
      )
      .slice(-remainingCapacity)
      .map(([sourceRef, source]) => ({
        sourceRef,
        sourceGroupId: checkpoint.sourceGroupId,
        sourceType: 'review',
        role: 'observer',
        excerpt: [...source.summaries].sort().join('\n').slice(0, 4_000),
        observedAt: source.observedAt,
      }));
    return { ...checkpoint, sources: [...checkpoint.sources, ...sources] };
  }

  async function isCompleted(context: AssembledProfileEvidenceContext): Promise<boolean> {
    const receipt = await input.evidence.checkpoints.get(
      receiptId(context.checkpoint.checkpointId),
    );
    if (
      receipt?.extractorVersion !== PROFILE_EVIDENCE_EXTRACTOR_VERSION ||
      receipt.outputChecksum !== context.sourceSnapshotHash
    ) {
      return false;
    }
    if (
      context.checkpoint.checkpointKind !== 'stage_review_finalized' &&
      context.checkpoint.checkpointKind !== 'lesson_review_finalized'
    ) {
      return true;
    }
    if (receipt.processedFactCount === 0) return true;
    let count = 0;
    for await (const episode of input.reasoning.listEpisodes()) {
      if (
        episode.extractorVersion === REVIEW_SESSION_DIMENSION_EXTRACTOR_VERSION &&
        episode.sourceObservationRef === `review-checkpoint:${context.checkpoint.checkpointId}`
      ) {
        count += 1;
      }
    }
    return count >= receipt.processedFactCount;
  }

  async function markCompleted(completion: {
    checkpointId: string;
    sourceType: unknown;
    sourceSnapshotHash: string;
    projectedCandidateCount: number;
    ignoredCandidateCount: number;
    updatedAt: string;
  }): Promise<void> {
    const checkpointId = receiptId(completion.checkpointId);
    const current = await input.evidence.checkpoints.get(checkpointId);
    const receipt: SourceCheckpoint = {
      checkpointId,
      sourceGroup: receiptSourceGroup(completion.sourceType),
      extractorVersion: PROFILE_EVIDENCE_EXTRACTOR_VERSION,
      outputChecksum: completion.sourceSnapshotHash,
      processedFactCount: completion.projectedCandidateCount,
      rejectedFactCount: completion.ignoredCandidateCount,
      updatedAt: completion.updatedAt,
      resourceVersion: current?.resourceVersion ?? 0,
    };
    await input.unitOfWork.execute(
      { transactionId: `tx_profile_evidence_receipt_${randomUUID()}` },
      (tx) => input.evidence.checkpoints.save(tx, receipt, receipt.resourceVersion),
    );
  }

  return { enrichReviewCheckpoint, isCompleted, markCompleted };
}
