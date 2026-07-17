import { describe, expect, it } from 'vitest';

import type { GenerationRequest, GenerationRuntime } from '../../generation-runtime/interface.js';
import type { GenerationTask } from '../../generation-runtime/ports/generation-task-repository.js';
import { createAiProfileEvidenceExtractor } from '../implementation/ai-profile-evidence-extractor.js';

function checkpoint() {
  return {
    checkpointId: 'checkpoint_authoring_baseline_1',
    checkpointKind: 'authoring_baseline',
    sourceType: 'outline',
    sourceGroupId: 'outline:session_1:baseline',
    dependentSourceGroupIds: [],
    courseContext: '学习区块链经济机制',
    completeness: 'complete',
    sources: [
      {
        sourceRef: 'message:user_1',
        sourceGroupId: 'outline:session_1:baseline',
        sourceType: 'outline',
        role: 'user',
        excerpt: '我想比较不同参与者在条件变化时的决策，并寻找反例。',
        observedAt: '2026-07-14T00:00:00.000Z',
      },
    ],
    existingCandidates: [],
  } as const;
}

function runtimeWith(output: unknown) {
  let request: GenerationRequest | undefined;
  let task: GenerationTask = {
    id: 'task_profile_evidence',
    taskKey: 'profile-evidence',
    status: 'queued',
    createdAt: '2026-07-14T00:00:00.000Z',
    updatedAt: '2026-07-14T00:00:00.000Z',
    resourceVersion: 0,
  };
  const runtime: GenerationRuntime = {
    async submit(input) {
      request = input;
      return { taskId: task.id };
    },
    async runNext() {
      task = { ...task, status: 'completed', draftMarkdown: JSON.stringify(output) };
      return task.id;
    },
    async get() {
      return task;
    },
    async cancel() {
      return task;
    },
    async recoverExpiredLeases() {
      return 0;
    },
    async getMetrics() {
      return { total: 1, byStatus: { completed: 1 }, byErrorCode: {} };
    },
  };
  return { runtime, request: () => request };
}

function draft(overrides: Record<string, unknown> = {}) {
  return {
    candidateKind: 'thinking_behavior',
    claimDimension: 'thinking_tendency.counterfactual_branching',
    label: '条件变化下的反事实分支',
    summary: '在当前课程创建讨论中，用户主动要求比较条件变化对参与者决策的影响。',
    explicitness: 'ai_observed',
    sourceRefs: ['message:user_1'],
    confidence: 0.78,
    qualityFlags: ['direct', 'complete'],
    limitations: ['只代表当前课程创建检查点中的行为。'],
    safetyStatus: 'usable',
    polarity: 'supporting',
    contradictionEvidenceIds: [],
    expiryPolicy: { kind: 'window_bound', expiresAt: '2026-10-14T00:00:00.000Z' },
    ...overrides,
  };
}

describe('AI profile evidence extractor', () => {
  it('drops pause lifecycle facts instead of turning them into behavior evidence', async () => {
    const fake = runtimeWith({
      candidates: [
        draft({
          claimDimension: 'learning.session_regulation',
          label: '暂停学习',
          summary: '用户在本次学习中暂停了计时。',
        }),
      ],
    });
    const extractor = createAiProfileEvidenceExtractor({
      runtime: fake.runtime,
      providerId: 'mock',
      analyzerVersion: 'profile-evidence-analyzer@1',
      extractorVersion: 'profile-evidence@1',
      now: () => new Date('2026-07-14T00:00:01.000Z'),
    });

    await expect(extractor.extract(checkpoint())).resolves.toMatchObject({ candidates: [] });
    expect(fake.request()?.prompt).toContain('不得生成 learning_behavior 或 thinking_behavior');
  });

  it('accepts an evidence-derived dimension that is not part of a fixed taxonomy', async () => {
    const fake = runtimeWith({ candidates: [draft()] });
    const extractor = createAiProfileEvidenceExtractor({
      runtime: fake.runtime,
      providerId: 'mock',
      analyzerVersion: 'profile-evidence-analyzer@1',
      extractorVersion: 'profile-evidence@1',
      now: () => new Date('2026-07-14T00:00:01.000Z'),
    });

    const result = await extractor.extract(checkpoint());

    expect(result.candidates[0]?.claimDimension).toBe('thinking_tendency.counterfactual_branching');
    expect(fake.request()?.taskKind).toBe('profile-evidence-extraction');
    expect(fake.request()?.prompt).toContain('不是固定维度表');
    expect(fake.request()?.prompt).toContain('claimDimension MUST be a stable lower-case ASCII');
    expect(fake.request()?.prompt).toContain('limitations MUST always be a JSON array of strings');
    expect(fake.request()?.prompt).not.toContain('promotionState');
  });

  it('rejects unsupported source refs and permanent-profile mutation fields', async () => {
    const unsupported = runtimeWith({
      candidates: [draft({ sourceRefs: ['message:not_in_checkpoint'] })],
    });
    const extractor = createAiProfileEvidenceExtractor({
      runtime: unsupported.runtime,
      providerId: 'mock',
      analyzerVersion: 'profile-evidence-analyzer@1',
      extractorVersion: 'profile-evidence@1',
      now: () => new Date('2026-07-14T00:00:01.000Z'),
    });
    await expect(extractor.extract(checkpoint())).rejects.toThrow(
      'profile_evidence_source_ref_unsupported',
    );

    const mutation = runtimeWith({ candidates: [draft({ confirmed: true })] });
    await expect(
      createAiProfileEvidenceExtractor({
        runtime: mutation.runtime,
        providerId: 'mock',
        analyzerVersion: 'profile-evidence-analyzer@1',
        extractorVersion: 'profile-evidence@1',
        now: () => new Date('2026-07-14T00:00:01.000Z'),
      }).extract(checkpoint()),
    ).rejects.toThrow();
  });

  it('rejects sensitive or permanent personality inference', async () => {
    const fake = runtimeWith({
      candidates: [draft({ summary: '用户具有固定人格和永久学习风格。' })],
    });
    await expect(
      createAiProfileEvidenceExtractor({
        runtime: fake.runtime,
        providerId: 'mock',
        analyzerVersion: 'profile-evidence-analyzer@1',
        extractorVersion: 'profile-evidence@1',
        now: () => new Date('2026-07-14T00:00:01.000Z'),
      }).extract(checkpoint()),
    ).rejects.toThrow('profile_evidence_forbidden_inference');
  });
});
