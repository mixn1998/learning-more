import { describe, expect, it } from 'vitest';

import type { PortraitEvidence, PortraitVersion } from '@learning-more/contracts';

import { buildPortraitInsights, portraitUpdatedLabel } from './portrait-workspace-model.js';

const portrait: PortraitVersion = {
  versionId: 'portrait_1',
  manifestId: 'manifest_1',
  state: 'completed',
  title: '有边界的学习观察',
  summary: '只描述当前证据。',
  claims: [
    {
      claimId: 'claim_1',
      markdown: '会根据新证据修正判断。',
      evidenceIds: ['support', 'counter', 'retracted'],
      confidence: 0.7,
      limitations: ['只覆盖近期课节。'],
      counterEvidenceChecked: true,
    },
  ],
  createdAt: '2026-07-12T08:00:00.000Z',
  updatedAt: '2026-07-12T08:00:00.000Z',
  resourceVersion: 1,
};

function evidence(
  evidenceId: string,
  polarity: PortraitEvidence['polarity'],
  status: PortraitEvidence['status'] = 'active',
): PortraitEvidence {
  return {
    evidenceId,
    summary: `${evidenceId} summary`,
    sourceGroup: polarity === 'supporting' ? 'behavior' : 'reflection',
    sourceGroupId: `${evidenceId}:group`,
    dependentSourceGroupIds: [],
    observedAt: '2026-07-10T00:00:00.000Z',
    strength: { score: 2, rationale: 'committed fact' },
    polarity,
    status,
  };
}

describe('portrait workspace projection', () => {
  it('exposes active supporting and counter evidence without leaking identifiers into copy', () => {
    const [insight] = buildPortraitInsights({
      portrait,
      evidence: [
        evidence('support', 'supporting'),
        evidence('counter', 'contradicting'),
        evidence('retracted', 'supporting', 'retracted'),
      ],
    });

    expect(insight).toMatchObject({
      claimId: 'claim_1',
      markdown: '### 你在学习中的一个做法\n\n会根据新证据修正判断。',
    });
    expect(insight?.evidence).toEqual([
      expect.objectContaining({
        title: '学习行为',
        summary: 'support summary',
      }),
      expect.objectContaining({
        title: '复盘反思',
        summary: 'counter summary',
        boundary: true,
      }),
    ]);
    expect(insight?.synthesis).toContain('2 次不同的学习记录');
    expect(insight?.synthesis).not.toContain('support');
  });

  it('uses an explicit limitation boundary when no counter evidence is available', () => {
    const [insight] = buildPortraitInsights({
      portrait,
      evidence: [evidence('support', 'supporting')],
    });
    expect(insight?.evidence.at(-1)).toEqual({
      title: '适用边界',
      summary: '只覆盖近期课节。',
      sourceGroup: 'boundary',
      boundary: true,
    });
  });

  it('keeps independent behavior sources concrete instead of collapsing them into one template', () => {
    const [insight] = buildPortraitInsights({
      portrait: {
        ...portrait,
        claims: [
          {
            ...portrait.claims[0]!,
            evidenceIds: ['support-a', 'support-b'],
          },
        ],
      },
      evidence: [evidence('support-a', 'supporting'), evidence('support-b', 'supporting')],
    });

    expect(insight?.evidence.slice(0, 2).map((item) => item.summary)).toEqual([
      'support-a summary',
      'support-b summary',
    ]);
  });

  it('formats the authoritative update timestamp in the product timezone', () => {
    expect(portraitUpdatedLabel('2026-07-11T16:30:00.000Z')).toBe('7月12日');
  });
});
