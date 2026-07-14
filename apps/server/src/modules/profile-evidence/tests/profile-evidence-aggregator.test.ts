import { describe, expect, it } from 'vitest';

import type { TransactionContext, UnitOfWork } from '../../../persistence/unit-of-work.js';
import { createProfileEvidenceAggregator } from '../implementation/profile-evidence-aggregator.js';
import type { ProfileEvidenceExtractionBatch } from '../implementation/ai-profile-evidence-extractor.js';
import { createInMemoryEvidenceRepositories } from '../ports/evidence-repository.js';

const transaction: TransactionContext = {
  async stageJson() {},
  async stageText() {},
  async deleteOnCommit() {},
};

const unitOfWork: UnitOfWork = {
  execute: async (_request, work) => work(transaction),
};

function batch(input: {
  checkpointId: string;
  sourceGroupId?: string;
  sourceRef?: string;
  sourceSnapshotHash: string;
  analyzerVersion?: string;
  confidence?: number;
  expiryPolicy?: { kind: 'window_bound'; expiresAt: string };
  contradictionEvidenceIds?: string[];
}): ProfileEvidenceExtractionBatch {
  const sourceGroupId = input.sourceGroupId ?? 'lesson:1:session:1';
  const sourceRef = input.sourceRef ?? `message:${input.checkpointId}`;
  return {
    checkpoint: {
      checkpointId: input.checkpointId,
      checkpointKind: 'teaching_session_closed',
      sourceType: 'lesson',
      sourceGroupId,
      dependentSourceGroupIds: [],
      lessonContext: '决策模型',
      completeness: 'complete',
      sources: [
        {
          sourceRef,
          sourceGroupId,
          sourceType: 'lesson',
          role: 'user',
          excerpt: '我先改变约束条件，再比较两个行为者会如何选择。',
          observedAt: '2026-07-14T00:00:00.000Z',
        },
      ],
      existingCandidates: [],
    },
    sourceSnapshotHash: input.sourceSnapshotHash,
    analyzerVersion: input.analyzerVersion ?? 'profile-evidence-analyzer@1',
    extractorVersion: 'profile-evidence@1',
    extractedAt: '2026-07-14T00:00:01.000Z',
    candidates: [
      {
        candidateKind: 'thinking_behavior',
        claimDimension: 'thinking_tendency.conditional_actor_comparison',
        label: '条件化的行为者比较',
        summary: '在当前检查点中通过改变约束条件比较行为者选择。',
        explicitness: 'ai_observed',
        sourceRefs: [sourceRef],
        confidence: input.confidence ?? 0.72,
        qualityFlags: ['direct', 'complete'],
        limitations: ['只代表当前受控检查点。'],
        safetyStatus: 'usable',
        polarity: 'supporting',
        contradictionEvidenceIds: input.contradictionEvidenceIds ?? [],
        expiryPolicy: input.expiryPolicy ?? {
          kind: 'window_bound',
          expiresAt: '2026-10-14T00:00:00.000Z',
        },
      },
    ],
  };
}

async function all(repositories: ReturnType<typeof createInMemoryEvidenceRepositories>) {
  const result = [];
  for await (const candidate of repositories.evidence.list()) result.push(candidate);
  return result;
}

describe('profile evidence aggregator', () => {
  it('deduplicates a retried checkpoint and aggregates a later observation', async () => {
    const repositories = createInMemoryEvidenceRepositories();
    const aggregator = createProfileEvidenceAggregator({
      repositories,
      unitOfWork,
      now: () => new Date('2026-07-14T00:00:02.000Z'),
      nextTransactionId: () => 'tx_profile_evidence',
    });
    const first = batch({ checkpointId: 'checkpoint_1', sourceSnapshotHash: 'a'.repeat(64) });
    await aggregator.ingest(first);
    await expect(aggregator.ingest(first)).resolves.toMatchObject({ skipped: 1 });
    await aggregator.ingest(
      batch({
        checkpointId: 'checkpoint_2',
        sourceRef: 'message:checkpoint_2',
        sourceSnapshotHash: 'b'.repeat(64),
        confidence: 0.81,
      }),
    );

    const candidates = await all(repositories);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.governance).toMatchObject({
      promotionState: 'candidate_only',
      observedCount: 2,
      checkpointIds: ['checkpoint_1', 'checkpoint_2'],
      confidence: 0.81,
    });
    expect(candidates[0]?.sourceRefs).toEqual(['message:checkpoint_1', 'message:checkpoint_2']);
  });

  it('supersedes instead of silently overwriting when the analyzer version changes', async () => {
    const repositories = createInMemoryEvidenceRepositories();
    const aggregator = createProfileEvidenceAggregator({
      repositories,
      unitOfWork,
      now: () => new Date('2026-07-14T00:00:02.000Z'),
      nextTransactionId: () => 'tx_profile_reanalysis',
    });
    const first = batch({ checkpointId: 'checkpoint_1', sourceSnapshotHash: 'c'.repeat(64) });
    await aggregator.ingest(first);
    await aggregator.ingest({ ...first, analyzerVersion: 'profile-evidence-analyzer@2' });

    const candidates = await all(repositories);
    expect(candidates.map((candidate) => candidate.status).sort()).toEqual([
      'active',
      'superseded',
    ]);
    expect(
      candidates.find((candidate) => candidate.status === 'active')?.governance?.supersedes,
    ).toHaveLength(1);
  });

  it('retains contradiction links, expires time-bound evidence, and propagates deletion', async () => {
    const repositories = createInMemoryEvidenceRepositories();
    let now = new Date('2026-07-14T00:00:02.000Z');
    const aggregator = createProfileEvidenceAggregator({
      repositories,
      unitOfWork,
      now: () => now,
      nextTransactionId: () => `tx_profile_${now.getTime()}`,
    });
    const first = batch({ checkpointId: 'checkpoint_1', sourceSnapshotHash: 'd'.repeat(64) });
    await aggregator.ingest(first);
    const evidenceId = (await all(repositories))[0]!.evidenceId;
    await aggregator.ingest(
      batch({
        checkpointId: 'checkpoint_2',
        sourceRef: 'message:checkpoint_2',
        sourceSnapshotHash: 'e'.repeat(64),
        contradictionEvidenceIds: [evidenceId],
        expiryPolicy: { kind: 'window_bound', expiresAt: '2026-07-15T00:00:00.000Z' },
      }),
    );
    expect((await all(repositories))[0]?.governance?.contradictionEvidenceIds).toContain(
      evidenceId,
    );

    now = new Date('2026-11-01T00:00:00.000Z');
    await aggregator.ingest({ ...first, candidates: [] });
    expect((await all(repositories))[0]?.status).toBe('retracted');

    const fresh = batch({
      checkpointId: 'checkpoint_3',
      sourceRef: 'message:checkpoint_3',
      sourceSnapshotHash: 'f'.repeat(64),
      sourceGroupId: 'lesson:2:session:1',
      expiryPolicy: { kind: 'window_bound', expiresAt: '2027-01-01T00:00:00.000Z' },
    });
    await aggregator.ingest(fresh);
    await expect(aggregator.retractBySourceRefs(['message:checkpoint_3'])).resolves.toEqual({
      retracted: 1,
    });
  });
});
