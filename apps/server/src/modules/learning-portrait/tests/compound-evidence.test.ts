import { describe, expect, it } from 'vitest';

import type { CandidateEvidence } from '../../profile-evidence/interface.js';
import { packPortraitEvidence } from '../implementation/evidence-packer.js';
import { createPortraitInputManifest } from '../implementation/portrait-input-manifest.js';
import { validatePortraitOutput } from '../implementation/portrait-validator.js';

function evidence(id: string, group: string, polarity: CandidateEvidence['polarity']) {
  return {
    evidenceId: id,
    claimDimension: 'learning.context_bound_pattern',
    summary: 'A neutral observation limited to one committed learning context.',
    sourceGroup: 'behavior' as const,
    sourceGroupId: group,
    dependentSourceGroupIds: [],
    sourceRefs: [`fact:${id}`],
    dataKeys: ['lesson.lifecycle_status'] as const,
    observedAt: '2026-07-10T00:00:00.000Z',
    strength: { score: 2 as const, rationale: 'A committed but context-bounded source fact.' },
    polarity,
    extractorVersion: 'reasoning-analyzer@2:reasoning-session-dimension@2',
    dedupKey: id.padEnd(64, 'a').slice(0, 64),
    status: 'active' as const,
    resourceVersion: 1,
  } satisfies CandidateEvidence;
}

describe('compound portrait evidence policy', () => {
  it('[EQ-POR-06] blocks a single source and requires an explicit counter-evidence check for independent sources', () => {
    const first = evidence('e1', 'lesson:01', 'supporting');
    expect(
      packPortraitEvidence({ evidence: [first], tokenBudget: 1_000, dimensionPriority: [] })
        .includedEvidenceIds,
    ).toEqual([]);

    const second = evidence('e2', 'lesson:02', 'contradicting');
    const packed = packPortraitEvidence({
      evidence: [first, second],
      tokenBudget: 1_000,
      dimensionPriority: [],
    });
    expect(packed.includedEvidenceIds).toEqual(['e1', 'e2']);
    const manifest = createPortraitInputManifest({
      profileVersion: 1,
      packedEvidence: packed,
      window: { from: '2026-07-01T00:00:00.000Z', to: '2026-08-01T00:00:00.000Z' },
      promptTemplateVersion: 'portrait@1',
      providerConfigFingerprint: 'a'.repeat(64),
      reasoningBehaviorInput: {
        snapshotId: 'reasoning_snapshot_01',
        sourceSnapshotHash: 'b'.repeat(64),
        dimensionSetVersion: 'dimension-set:01',
      },
      createdAt: '2026-07-13T00:00:00.000Z',
    });
    expect(manifest.reasoningBehaviorInput).toEqual({
      snapshotId: 'reasoning_snapshot_01',
      sourceSnapshotHash: 'b'.repeat(64),
      dimensionSetVersion: 'dimension-set:01',
    });
    const output = {
      title: '你会根据具体情况调整判断',
      summary:
        '你在不同学习记录中都会结合当时情况修改判断。这只代表当前记录，不说明固定性格或能力。',
      claims: [
        {
          claimId: 'claim_01',
          markdown: '### 你会结合当时情况再判断\n\n条件改变时，你会重新检查原来的选择是否还合适。',
          evidenceIds: ['e1', 'e2'],
          confidence: 0.6,
          limitations: ['不一致的学习记录会缩小这条结论的适用范围。'],
          counterEvidenceChecked: false,
        },
      ],
    };
    expect(() => validatePortraitOutput({ output, manifest, evidence: [first, second] })).toThrow();
    expect(
      validatePortraitOutput({
        output: {
          ...output,
          claims: [{ ...output.claims[0]!, counterEvidenceChecked: true }],
        },
        manifest,
        evidence: [first, second],
      }).claims,
    ).toHaveLength(1);
  });
});
