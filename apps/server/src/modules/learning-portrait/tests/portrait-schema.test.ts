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
        title: 'A freely named portrait',
        summary: 'The analysis chooses its own framing.',
        claims: [
          {
            claimId: 'custom-insight-one',
            markdown: 'An arbitrary insight body without a predefined category.',
            evidenceIds: ['e1', 'e2'],
            confidence: 0.7,
            limitations: ['Context remains bounded.'],
            counterEvidenceChecked: true,
          },
          {
            claimId: 'another-shape',
            markdown: 'A second insight is optional and independently titled.',
            evidenceIds: ['e1', 'e2'],
            confidence: 0.6,
            limitations: ['More observations may change it.'],
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
});
