import { createHash } from 'node:crypto';

import type { DataKey, ProfileEvidenceExpiryPolicy } from '@learning-more/contracts';

import type { TransactionContext, UnitOfWork } from '../../../persistence/unit-of-work.js';
import type { CandidateEvidence, EvidenceSourceGroup } from '../interface.js';
import type { ProfileEvidenceExtractionDraft } from '../model/profile-evidence-candidate.js';
import { profileEvidenceSemanticKey } from '../model/profile-evidence-candidate.js';
import type { EvidenceRepositories } from '../ports/evidence-repository.js';
import type { ProfileEvidenceExtractionBatch } from './ai-profile-evidence-extractor.js';
import { parseCandidateEvidence } from './candidate-evidence.js';

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function sourceGroupFor(
  sourceType: ProfileEvidenceExtractionBatch['checkpoint']['sourceType'],
): EvidenceSourceGroup {
  if (sourceType === 'review') return 'review';
  if (sourceType === 'outline') return 'reflection';
  return 'behavior';
}

function dataKeysFor(
  sourceType: ProfileEvidenceExtractionBatch['checkpoint']['sourceType'],
): readonly DataKey[] {
  if (sourceType === 'outline') {
    return [
      'user_profile.evidence.summary',
      'user_profile.evidence.source_refs',
      'outline.topic_raw',
    ];
  }
  if (sourceType === 'review') {
    return [
      'user_profile.evidence.summary',
      'user_profile.evidence.source_refs',
      'review.markdown',
    ];
  }
  return [
    'user_profile.evidence.summary',
    'user_profile.evidence.source_refs',
    'conversation.markdown',
  ];
}

function strength(confidence: number, observedCount: number) {
  const score: 1 | 2 | 3 = confidence >= 0.8 && observedCount >= 2 ? 3 : confidence >= 0.55 ? 2 : 1;
  return {
    score,
    rationale: `候选证据置信度 ${confidence.toFixed(2)}，累计 ${observedCount} 个受控检查点；仍需结合来源独立性、反向证据与时效解释。`,
  } as const;
}

function laterExpiry(
  left: ProfileEvidenceExpiryPolicy,
  right: ProfileEvidenceExpiryPolicy,
): ProfileEvidenceExpiryPolicy {
  if (left.kind === 'until_corrected' || right.kind === 'until_corrected') {
    return { kind: 'until_corrected' };
  }
  const leftDate = left.kind === 'window_bound' ? left.expiresAt : left.reviewAt;
  const rightDate = right.kind === 'window_bound' ? right.expiresAt : right.reviewAt;
  return Date.parse(leftDate) >= Date.parse(rightDate) ? left : right;
}

function expiryReached(policy: ProfileEvidenceExpiryPolicy, now: Date): boolean {
  if (policy.kind === 'until_corrected') return false;
  return (
    Date.parse(policy.kind === 'window_bound' ? policy.expiresAt : policy.reviewAt) <= now.getTime()
  );
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function observedRange(batch: ProfileEvidenceExtractionBatch, sourceRefs: readonly string[]) {
  const allowed = new Set(sourceRefs);
  const observed = batch.checkpoint.sources
    .filter((source) => allowed.has(source.sourceRef))
    .map((source) => source.observedAt)
    .sort();
  if (observed.length === 0) throw new Error('profile_evidence_observed_range_missing');
  return { first: observed[0]!, last: observed.at(-1)! };
}

function coalesceDrafts(drafts: readonly ProfileEvidenceExtractionDraft[]) {
  const grouped = new Map<string, ProfileEvidenceExtractionDraft>();
  for (const draft of drafts) {
    const semanticKey = profileEvidenceSemanticKey(draft);
    const current = grouped.get(semanticKey);
    if (current === undefined) {
      grouped.set(semanticKey, draft);
      continue;
    }
    grouped.set(semanticKey, {
      ...current,
      summary: draft.confidence >= current.confidence ? draft.summary : current.summary,
      explicitness:
        current.explicitness === 'user_declared' || draft.explicitness === 'user_declared'
          ? 'user_declared'
          : 'ai_observed',
      sourceRefs: unique([...current.sourceRefs, ...draft.sourceRefs]),
      confidence: Math.max(current.confidence, draft.confidence),
      qualityFlags: unique([...current.qualityFlags, ...draft.qualityFlags]),
      limitations: unique([...current.limitations, ...draft.limitations]),
      safetyStatus:
        current.safetyStatus === 'blocked' || draft.safetyStatus === 'blocked'
          ? 'blocked'
          : current.safetyStatus === 'sanitized' || draft.safetyStatus === 'sanitized'
            ? 'sanitized'
            : 'usable',
      ...(draft.blockedReason === undefined ? {} : { blockedReason: draft.blockedReason }),
      polarity:
        current.polarity === 'contradicting' || draft.polarity === 'contradicting'
          ? 'contradicting'
          : current.polarity === 'limiting' || draft.polarity === 'limiting'
            ? 'limiting'
            : 'supporting',
      contradictionEvidenceIds: unique([
        ...current.contradictionEvidenceIds,
        ...draft.contradictionEvidenceIds,
      ]),
      expiryPolicy: laterExpiry(current.expiryPolicy, draft.expiryPolicy),
    });
  }
  return grouped;
}

function newEvidence(
  batch: ProfileEvidenceExtractionBatch,
  draft: ProfileEvidenceExtractionDraft,
  semanticKey: string,
  now: Date,
  input: Readonly<{
    evidenceId?: string;
    observedCount?: number;
    supersedes?: readonly string[];
    checkpointIds?: readonly string[];
    sourceSnapshotHashes?: readonly string[];
    observationKeys?: readonly string[];
    firstObservedAt?: string;
    sourceRefs?: readonly string[];
  }> = {},
): CandidateEvidence {
  const sourceRefs = input.sourceRefs ?? draft.sourceRefs;
  const range = observedRange(batch, draft.sourceRefs);
  const observedCount = input.observedCount ?? 1;
  const observationKey = sha256(
    `${semanticKey}:${batch.checkpoint.sourceGroupId}:${batch.sourceSnapshotHash}`,
  );
  const evidenceId =
    input.evidenceId ??
    `evidence_checkpoint_${sha256(`${semanticKey}:${batch.checkpoint.sourceGroupId}:${batch.analyzerVersion}`).slice(0, 40)}`;
  return parseCandidateEvidence(
    {
      evidenceId,
      claimDimension: draft.claimDimension,
      summary: draft.summary,
      sourceGroup: sourceGroupFor(batch.checkpoint.sourceType),
      sourceGroupId: batch.checkpoint.sourceGroupId,
      dependentSourceGroupIds: batch.checkpoint.dependentSourceGroupIds,
      sourceRefs: unique(sourceRefs).sort(),
      dataKeys: dataKeysFor(batch.checkpoint.sourceType),
      observedAt: range.last,
      strength: strength(draft.confidence, observedCount),
      polarity: draft.polarity,
      extractorVersion: batch.extractorVersion,
      dedupKey: sha256(`${semanticKey}:${batch.checkpoint.sourceGroupId}:${batch.analyzerVersion}`),
      status: 'active',
      governance: {
        schemaVersion: 1,
        promotionState: 'candidate_only',
        candidateKind: draft.candidateKind,
        label: draft.label,
        explicitness: draft.explicitness,
        checkpointId: batch.checkpoint.checkpointId,
        checkpointIds: unique([...(input.checkpointIds ?? []), batch.checkpoint.checkpointId]),
        checkpointKind: batch.checkpoint.checkpointKind,
        sourceType: batch.checkpoint.sourceType,
        ...(batch.checkpoint.courseContext === undefined
          ? {}
          : { courseContext: batch.checkpoint.courseContext }),
        ...(batch.checkpoint.lessonContext === undefined
          ? {}
          : { lessonContext: batch.checkpoint.lessonContext }),
        confidence: draft.confidence,
        observedCount,
        firstObservedAt: input.firstObservedAt ?? range.first,
        lastObservedAt: range.last,
        sourceSnapshotHash: batch.sourceSnapshotHash,
        sourceSnapshotHashes: unique([
          ...(input.sourceSnapshotHashes ?? []),
          batch.sourceSnapshotHash,
        ]),
        observationKeys: unique([...(input.observationKeys ?? []), observationKey]),
        qualityFlags: draft.qualityFlags,
        limitations: draft.limitations,
        safetyStatus: draft.safetyStatus,
        ...(draft.blockedReason === undefined ? {} : { blockedReason: draft.blockedReason }),
        contradictionEvidenceIds: unique(draft.contradictionEvidenceIds),
        expiryPolicy: draft.expiryPolicy,
        semanticKey,
        supersedes: unique(input.supersedes ?? []),
        analyzerVersion: batch.analyzerVersion,
        extractedAt: batch.extractedAt,
      },
      resourceVersion: 0,
    },
    now,
  );
}

export function createProfileEvidenceAggregator(options: {
  repositories: EvidenceRepositories;
  unitOfWork: UnitOfWork;
  now(): Date;
  nextTransactionId(): string;
  recordExtracted?(
    event: Readonly<{
      checkpointId: string;
      checkpointKind: ProfileEvidenceExtractionBatch['checkpoint']['checkpointKind'];
      sourceSnapshotHash: string;
      evidenceIds: readonly string[];
      created: number;
      updated: number;
      superseded: number;
      rejected: number;
      skipped: number;
    }>,
    tx: TransactionContext,
  ): Promise<void>;
}) {
  async function list(): Promise<CandidateEvidence[]> {
    const candidates: CandidateEvidence[] = [];
    for await (const candidate of options.repositories.evidence.list()) candidates.push(candidate);
    return candidates;
  }

  return {
    async ingest(batch: ProfileEvidenceExtractionBatch) {
      const now = options.now();
      const existing = await list();
      const updates = new Map<string, CandidateEvidence>();
      const additions: CandidateEvidence[] = [];
      let rejected = 0;
      let skipped = 0;
      let superseded = 0;

      for (const candidate of existing) {
        if (
          candidate.status === 'active' &&
          candidate.governance !== undefined &&
          expiryReached(candidate.governance.expiryPolicy, now)
        ) {
          updates.set(candidate.evidenceId, { ...candidate, status: 'retracted' });
        }
      }

      for (const [semanticKey, draft] of coalesceDrafts(batch.candidates)) {
        if (draft.safetyStatus === 'blocked' || draft.confidence < 0.45) {
          rejected += 1;
          continue;
        }
        const observationKey = sha256(
          `${semanticKey}:${batch.checkpoint.sourceGroupId}:${batch.sourceSnapshotHash}`,
        );
        const previous = existing.find(
          (candidate) =>
            (updates.get(candidate.evidenceId)?.status ?? candidate.status) === 'active' &&
            candidate.governance?.semanticKey === semanticKey &&
            candidate.sourceGroupId === batch.checkpoint.sourceGroupId,
        );
        if (previous?.governance?.observationKeys.includes(observationKey)) {
          if (previous.governance.analyzerVersion === batch.analyzerVersion) {
            skipped += 1;
            continue;
          }
          updates.set(previous.evidenceId, { ...previous, status: 'superseded' });
          additions.push(
            newEvidence(batch, draft, semanticKey, now, {
              observedCount: previous.governance.observedCount,
              supersedes: [previous.evidenceId],
              checkpointIds: previous.governance.checkpointIds,
              sourceSnapshotHashes: previous.governance.sourceSnapshotHashes,
              observationKeys: previous.governance.observationKeys,
              firstObservedAt: previous.governance.firstObservedAt,
              sourceRefs: previous.sourceRefs,
            }),
          );
          superseded += 1;
          continue;
        }
        if (previous?.governance !== undefined) {
          const range = observedRange(batch, draft.sourceRefs);
          const observedCount = previous.governance.observedCount + 1;
          updates.set(
            previous.evidenceId,
            parseCandidateEvidence(
              {
                ...previous,
                summary: draft.summary,
                sourceRefs: unique([...previous.sourceRefs, ...draft.sourceRefs]).sort(),
                observedAt: range.last,
                strength: strength(
                  Math.max(previous.governance.confidence, draft.confidence),
                  observedCount,
                ),
                polarity: draft.polarity,
                extractorVersion: batch.extractorVersion,
                governance: {
                  ...previous.governance,
                  explicitness:
                    previous.governance.explicitness === 'user_declared' ||
                    draft.explicitness === 'user_declared'
                      ? 'user_declared'
                      : 'ai_observed',
                  checkpointId: batch.checkpoint.checkpointId,
                  checkpointIds: unique([
                    ...previous.governance.checkpointIds,
                    batch.checkpoint.checkpointId,
                  ]),
                  checkpointKind: batch.checkpoint.checkpointKind,
                  confidence: Math.max(previous.governance.confidence, draft.confidence),
                  observedCount,
                  lastObservedAt: range.last,
                  sourceSnapshotHash: batch.sourceSnapshotHash,
                  sourceSnapshotHashes: unique([
                    ...previous.governance.sourceSnapshotHashes,
                    batch.sourceSnapshotHash,
                  ]),
                  observationKeys: unique([...previous.governance.observationKeys, observationKey]),
                  qualityFlags: unique([
                    ...previous.governance.qualityFlags,
                    ...draft.qualityFlags,
                  ]),
                  limitations: unique([...previous.governance.limitations, ...draft.limitations]),
                  contradictionEvidenceIds: unique([
                    ...previous.governance.contradictionEvidenceIds,
                    ...draft.contradictionEvidenceIds,
                  ]),
                  expiryPolicy: laterExpiry(previous.governance.expiryPolicy, draft.expiryPolicy),
                  analyzerVersion: batch.analyzerVersion,
                  extractedAt: batch.extractedAt,
                },
              },
              now,
            ),
          );
          continue;
        }
        additions.push(newEvidence(batch, draft, semanticKey, now));
      }

      await options.unitOfWork.execute(
        { transactionId: options.nextTransactionId() },
        async (tx) => {
          for (const update of [...updates.values()].sort((left, right) =>
            left.evidenceId.localeCompare(right.evidenceId),
          )) {
            await options.repositories.evidence.save(tx, update, update.resourceVersion);
          }
          for (const addition of additions.sort((left, right) =>
            left.evidenceId.localeCompare(right.evidenceId),
          )) {
            await options.repositories.evidence.save(tx, addition, 0);
          }
          await options.recordExtracted?.(
            {
              checkpointId: batch.checkpoint.checkpointId,
              checkpointKind: batch.checkpoint.checkpointKind,
              sourceSnapshotHash: batch.sourceSnapshotHash,
              evidenceIds: unique([
                ...additions.map((candidate) => candidate.evidenceId),
                ...[...updates.values()]
                  .filter((candidate) => candidate.status === 'active')
                  .map((candidate) => candidate.evidenceId),
              ]).sort(),
              created: additions.length,
              updated: [...updates.values()].filter((candidate) => candidate.status === 'active')
                .length,
              superseded,
              rejected,
              skipped,
            },
            tx,
          );
        },
      );
      return {
        created: additions.length,
        updated: [...updates.values()].filter((candidate) => candidate.status === 'active').length,
        superseded,
        expired: [...updates.values()].filter((candidate) => candidate.status === 'retracted')
          .length,
        rejected,
        skipped,
      };
    },

    async expire() {
      const now = options.now();
      const updates = (await list()).filter(
        (candidate) =>
          candidate.status === 'active' &&
          candidate.governance !== undefined &&
          expiryReached(candidate.governance.expiryPolicy, now),
      );
      await options.unitOfWork.execute(
        { transactionId: options.nextTransactionId() },
        async (tx) => {
          for (const candidate of updates) {
            await options.repositories.evidence.save(
              tx,
              { ...candidate, status: 'retracted' },
              candidate.resourceVersion,
            );
          }
        },
      );
      return { expired: updates.length };
    },

    async retractBySourceRefs(sourceRefs: readonly string[]) {
      const targets = new Set(sourceRefs);
      const updates = (await list()).filter(
        (candidate) =>
          candidate.status === 'active' &&
          candidate.sourceRefs.some((sourceRef) => targets.has(sourceRef)),
      );
      await options.unitOfWork.execute(
        { transactionId: options.nextTransactionId() },
        async (tx) => {
          for (const candidate of updates) {
            await options.repositories.evidence.save(
              tx,
              { ...candidate, status: 'retracted' },
              candidate.resourceVersion,
            );
          }
        },
      );
      return { retracted: updates.length };
    },

    async correct(evidenceId: string) {
      const candidate = await options.repositories.evidence.get(evidenceId);
      if (candidate === undefined) throw new Error('profile_evidence_not_found');
      if (candidate.status !== 'active') return candidate;
      const corrected = { ...candidate, status: 'retracted' as const };
      await options.unitOfWork.execute({ transactionId: options.nextTransactionId() }, (tx) =>
        options.repositories.evidence.save(tx, corrected, candidate.resourceVersion),
      );
      return { ...corrected, resourceVersion: candidate.resourceVersion + 1 };
    },
  };
}
