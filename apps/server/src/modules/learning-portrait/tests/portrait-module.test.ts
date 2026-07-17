import { describe, expect, it, vi } from 'vitest';

import type { CandidateEvidence } from '../../profile-evidence/interface.js';
import { createInMemoryEvidenceRepositories } from '../../profile-evidence/ports/evidence-repository.js';
import { packPortraitEvidence } from '../implementation/evidence-packer.js';
import { createPortraitModule } from '../implementation/portrait-module.js';
import { createInMemoryPortraitRepository } from '../ports/portrait-repository.js';

const tx = {
  stageJson: async () => undefined,
  stageText: async () => undefined,
  deleteOnCommit: async () => undefined,
};
const unitOfWork = {
  async execute<T>(_request: unknown, work: (context: typeof tx) => Promise<T>) {
    return work(tx);
  },
};

function evidence(
  id: string,
  group: string,
  dependencies: readonly string[] = [],
): CandidateEvidence {
  return {
    evidenceId: id,
    claimDimension: 'learning.follow_through',
    summary: `Neutral bounded observation from ${group}.`,
    sourceGroup: 'behavior',
    sourceGroupId: group,
    dependentSourceGroupIds: dependencies,
    sourceRefs: [`fact:fact_${id}`],
    dataKeys: ['lesson.lifecycle_status'],
    observedAt: '2026-07-10T00:00:00.000Z',
    strength: { score: 2, rationale: 'Committed fact in a bounded local learning context.' },
    polarity: 'supporting',
    extractorVersion: 'reasoning-analyzer@2:reasoning-session-dimension@2',
    dedupKey: id.padEnd(64, 'a').slice(0, 64),
    status: 'active',
    resourceVersion: 1,
  };
}

async function fixture(candidates = [evidence('e1', 'lesson:01'), evidence('e2', 'lesson:02')]) {
  const portraits = createInMemoryPortraitRepository();
  const evidenceRepositories = createInMemoryEvidenceRepositories();
  for (const candidate of candidates) {
    await evidenceRepositories.evidence.save(tx, { ...candidate, resourceVersion: 0 }, 0);
  }
  const submit = vi.fn().mockResolvedValue({ taskId: 'task_portrait_01' });
  let version = 0;
  let transaction = 0;
  const module = createPortraitModule({
    repository: portraits,
    evidenceRepository: evidenceRepositories.evidence,
    unitOfWork,
    generationRuntime: { submit },
    nextVersionId: () => `portrait_${++version}`,
    nextTransactionId: () => `tx_portrait_${++transaction}`,
    now: () => new Date('2026-07-13T00:00:00.000Z'),
  });
  const packedEvidence = packPortraitEvidence({
    evidence: candidates,
    tokenBudget: 1_000,
    dimensionPriority: [],
  });
  return { module, portraits, submit, packedEvidence };
}

const request = {
  profileVersion: 1,
  window: { from: '2026-07-01T00:00:00.000Z', to: '2026-08-01T00:00:00.000Z' },
  promptTemplateVersion: 'portrait@1',
  providerConfigFingerprint: 'a'.repeat(64),
  idempotencyKey: 'refresh_01',
};

function validOutput(evidenceIds = ['e1', 'e2']) {
  return {
    title: 'A bounded learning portrait',
    summary: 'Current evidence supports one context-limited observation.',
    claims: [
      {
        claimId: 'claim_01',
        markdown: 'Across two lessons, the learner returned to incomplete work.',
        evidenceIds,
        confidence: 0.72,
        limitations: ['The evidence covers only the current observation window.'],
        counterEvidenceChecked: true,
      },
    ],
  };
}

describe('PortraitModule', () => {
  it('[EQ-POR-01] commits a zero-claim result instead of inventing a template personality when evidence is insufficient', async () => {
    const { module, packedEvidence } = await fixture([]);
    const generating = await module.requestRefresh({ ...request, packedEvidence });
    const completed = await module.finalize(generating.versionId, 'task_portrait_01', {
      title: 'Learning Portrait V2 — Insufficient Evidence',
      summary: 'No stable observation can be made.',
      claims: [],
    });
    expect(completed).toMatchObject({
      state: 'completed',
      title: '学习画像：证据尚不足',
      claims: [],
    });
    expect(JSON.stringify(completed)).not.toMatch(/personality|人格|学习风格/i);
  });

  it('freezes the manifest before submit and joins the same idempotency key', async () => {
    const { module, portraits, submit, packedEvidence } = await fixture();
    submit.mockImplementationOnce(async () => {
      const manifests = [];
      for await (const manifest of portraits.listManifests()) manifests.push(manifest);
      expect(manifests).toHaveLength(1);
      return { taskId: 'task_portrait_01' };
    });
    const first = await module.requestRefresh({ ...request, packedEvidence });
    const repeated = await module.requestRefresh({ ...request, packedEvidence });
    expect(repeated).toEqual(first);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(first).toMatchObject({ state: 'generating', generationTaskId: 'task_portrait_01' });
    const prompt = submit.mock.calls[0]?.[0]?.prompt as string;
    expect(prompt).toContain('【机器输出契约】');
    expect(prompt).toContain('【输出语言】');
    expect(prompt).toContain('简体中文');
    expect(prompt).toContain('【可用学习证据】');
    expect(prompt).toContain('证据编号：e1');
    expect(prompt).toContain('Neutral bounded observation from lesson:01.');
    expect(prompt).not.toContain('manifestId');
    expect(prompt).not.toContain('profileVersion');
    expect(prompt).not.toContain('providerConfigFingerprint');
    expect(prompt).not.toContain('sourceGroupId');
    expect(prompt).not.toContain('resourceVersion');
    expect(prompt).not.toContain('fact:fact_e1');
  });

  it('rejects output references outside the frozen manifest', async () => {
    const { module, portraits, packedEvidence } = await fixture();
    const generating = await module.requestRefresh({ ...request, packedEvidence });
    await expect(
      module.finalize(generating.versionId, 'task_portrait_01', validOutput(['e1', 'outside'])),
    ).rejects.toMatchObject({ code: 'portrait_evidence_outside_manifest' });
    await expect(portraits.getCurrent()).resolves.toBeUndefined();
    await expect(portraits.getVersion(generating.versionId)).resolves.toMatchObject({
      state: 'generating',
    });
  });

  it('rejects a stable claim whose references collapse to one dependent source', async () => {
    const candidates = [
      evidence('e1', 'lesson:01'),
      evidence('e2', 'review:lesson:01', ['lesson:01']),
    ];
    const { module, packedEvidence } = await fixture(candidates);
    const defensivePack = { ...packedEvidence, includedEvidenceIds: ['e1', 'e2'] };
    const generating = await module.requestRefresh({
      ...request,
      packedEvidence: defensivePack,
    });
    await expect(
      module.finalize(generating.versionId, 'task_portrait_01', validOutput()),
    ).rejects.toMatchObject({ code: 'portrait_claim_not_composite' });
  });

  it('[EQ-POR-03] keeps failed drafts and the previous successful version current', async () => {
    const { module, portraits, packedEvidence } = await fixture();
    const first = await module.requestRefresh({ ...request, packedEvidence });
    const completed = await module.finalize(first.versionId, 'task_portrait_01', validOutput());
    const second = await module.requestRefresh({
      ...request,
      idempotencyKey: 'refresh_02',
      packedEvidence,
    });
    await module.fail(second.versionId, second.generationTaskId!, 'provider_timeout', 'draft_02');
    await expect(portraits.getCurrent()).resolves.toMatchObject({
      currentVersionId: completed.versionId,
    });
    await expect(portraits.getVersion(second.versionId)).resolves.toMatchObject({
      state: 'failed',
      errorCode: 'provider_timeout',
      draftArtifactRef: 'draft_02',
    });
  });

  it('creates immutable versions and atomically advances the current cursor', async () => {
    const { module, portraits, packedEvidence } = await fixture();
    const first = await module.requestRefresh({ ...request, packedEvidence });
    const version1 = await module.finalize(first.versionId, 'task_portrait_01', validOutput());
    const second = await module.requestRefresh({
      ...request,
      idempotencyKey: 'refresh_02',
      packedEvidence,
    });
    const version2 = await module.finalize(second.versionId, 'task_portrait_01', validOutput());
    expect(version2.versionId).not.toBe(version1.versionId);
    await expect(portraits.getVersion(version1.versionId)).resolves.toEqual(version1);
    await expect(portraits.getCurrent()).resolves.toMatchObject({
      currentVersionId: version2.versionId,
    });
    await expect(
      module.finalize(version1.versionId, 'task_portrait_01', validOutput()),
    ).resolves.toEqual(version1);
  });
});
