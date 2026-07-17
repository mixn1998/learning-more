import { describe, expect, it } from 'vitest';

import type { CandidateEvidence } from '../../profile-evidence/interface.js';
import type { PortraitInputManifest } from '../interface.js';
import { validatePortraitOutput } from '../implementation/portrait-validator.js';

function evidence(id: string, sourceGroupId: string): CandidateEvidence {
  return {
    evidenceId: id,
    claimDimension: 'free.form',
    summary: `Neutral evidence ${id} from a bounded independent source.`,
    sourceGroup: 'behavior',
    sourceGroupId,
    dependentSourceGroupIds: [],
    sourceRefs: [`fact:${id}`],
    dataKeys: ['lesson.lifecycle_status'],
    observedAt: '2026-07-13T00:00:00.000Z',
    strength: { score: 2, rationale: 'Bounded evidence for schema validation.' },
    polarity: 'supporting',
    extractorVersion: 'test@1',
    dedupKey: id.padEnd(64, 'a').slice(0, 64),
    status: 'active',
    resourceVersion: 1,
  };
}

describe('portrait output schema', () => {
  it('[EQ-POR-08] fixes only title, summary, insight, and evidence containers while leaving analysis dimensions and card count free', () => {
    const sources = [evidence('e1', 'lesson:1'), evidence('e2', 'course:2')];
    const manifest: PortraitInputManifest = {
      manifestId: 'manifest_01',
      profileVersion: 1,
      evidencePackChecksum: 'checksum',
      includedEvidenceIds: sources.map((item) => item.evidenceId),
      window: { from: '2026-07-01T00:00:00.000Z', to: '2026-08-01T00:00:00.000Z' },
      policyVersion: 'policy@1',
      promptTemplateVersion: 'portrait@1',
      providerConfigFingerprint: 'a'.repeat(64),
      manifestChecksum: 'manifest-checksum',
      createdAt: '2026-07-13T00:00:00.000Z',
    };
    const output = validatePortraitOutput({
      manifest,
      evidence: sources,
      output: {
        title: '你会根据新的情况调整做法',
        summary:
          '你在不同学习记录中都会根据后续结果修改原来的判断。这只代表当前记录，不说明固定性格或能力。',
        claims: [
          {
            claimId: 'custom-insight-one',
            markdown: '### 你会回头检查结果\n\n你会根据后续结果修改原来的解释。',
            evidenceIds: ['e1', 'e2'],
            confidence: 0.7,
            limitations: ['只覆盖当前已经记录的学习情境。'],
            counterEvidenceChecked: true,
          },
          {
            claimId: 'another-shape',
            markdown: '### 你会保留改变主意的空间\n\n有新情况出现时，你会重新比较原来的选择。',
            evidenceIds: ['e1', 'e2'],
            confidence: 0.6,
            limitations: ['更多学习记录可能改变这条观察。'],
            counterEvidenceChecked: true,
          },
        ],
      },
    });

    expect(output.claims).toHaveLength(2);
    expect(output).not.toHaveProperty('dimensions');
    expect(output).not.toHaveProperty('suggestions');
    expect(output).not.toHaveProperty('successCriteria');
  });

  it('rejects backend analysis jargon from learner-facing portrait copy', () => {
    const sources = [evidence('e1', 'lesson:1'), evidence('e2', 'course:2')];
    const manifest: PortraitInputManifest = {
      manifestId: 'manifest_internal_language',
      profileVersion: 1,
      evidencePackChecksum: 'checksum',
      includedEvidenceIds: sources.map((item) => item.evidenceId),
      window: { from: '2026-07-01T00:00:00.000Z', to: '2026-08-01T00:00:00.000Z' },
      policyVersion: 'policy@1',
      promptTemplateVersion: 'portrait@1',
      providerConfigFingerprint: 'a'.repeat(64),
      manifestChecksum: 'manifest-checksum',
      createdAt: '2026-07-13T00:00:00.000Z',
    };

    expect(() =>
      validatePortraitOutput({
        manifest,
        evidence: sources,
        output: {
          title: '近期学习观察',
          summary: '这里只描述最近的学习记录。',
          claims: [
            {
              claimId: 'internal-jargon',
              markdown: '### 链式可行性追踪\n\n你表现出了较稳定的分析粒度控制。',
              evidenceIds: ['e1', 'e2'],
              confidence: 0.7,
              limitations: ['只覆盖近期学习。'],
              counterEvidenceChecked: true,
            },
          ],
        },
      }),
    ).toThrow('portrait_user_facing_language_invalid');
  });

  it('rejects missing, repeated, or placeholder claim titles', () => {
    const sources = [evidence('e1', 'lesson:1'), evidence('e2', 'course:2')];
    const manifest: PortraitInputManifest = {
      manifestId: 'manifest_placeholder_titles',
      profileVersion: 1,
      evidencePackChecksum: 'checksum',
      includedEvidenceIds: sources.map((item) => item.evidenceId),
      window: { from: '2026-07-01T00:00:00.000Z', to: '2026-08-01T00:00:00.000Z' },
      policyVersion: 'policy@1',
      promptTemplateVersion: 'portrait@1',
      providerConfigFingerprint: 'a'.repeat(64),
      manifestChecksum: 'manifest-checksum',
      createdAt: '2026-07-13T00:00:00.000Z',
    };
    const output = (markdown: string) => ({
      title: '你会根据新的情况调整做法',
      summary:
        '你在不同学习记录中都会根据后续结果修改原来的判断。这只代表当前记录，不说明固定性格或能力。',
      claims: [
        {
          claimId: 'placeholder-title',
          markdown,
          evidenceIds: ['e1', 'e2'],
          confidence: 0.7,
          limitations: ['只覆盖近期学习。'],
          counterEvidenceChecked: true,
        },
      ],
    });

    expect(() =>
      validatePortraitOutput({ manifest, evidence: sources, output: output('没有标题。') }),
    ).toThrow('portrait_user_facing_language_invalid');
    expect(() =>
      validatePortraitOutput({
        manifest,
        evidence: sources,
        output: output('### 你在学习中的一个做法\n\n这里仍然是占位文案。'),
      }),
    ).toThrow('portrait_user_facing_language_invalid');

    expect(() =>
      validatePortraitOutput({
        manifest,
        evidence: sources,
        output: {
          ...output('### 你会回头检查结果\n\n你会根据结果修改判断。'),
          claims: [
            output('### 你会回头检查结果\n\n你会根据结果修改判断。').claims[0]!,
            {
              ...output('### 你会回头检查结果\n\n另一条内容。').claims[0]!,
              claimId: 'same-title-again',
            },
          ],
        },
      }),
    ).toThrow('portrait_user_facing_language_invalid');
  });
});
