// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { PortraitEvidenceView, PortraitVersionView } from '../../client/profile-client.js';
import { PortraitView } from './portrait-view.js';

afterEach(cleanup);

const evidence: readonly PortraitEvidenceView[] = [
  {
    evidenceId: 'internal_e1',
    summary: 'The lesson was resumed in a later independent session.',
    sourceGroup: 'behavior',
    sourceGroupId: 'lesson:01',
    dependentSourceGroupIds: [],
    observedAt: '2026-07-10T00:00:00.000Z',
    strength: { score: 2, rationale: 'Explicit committed lifecycle fact.' },
    polarity: 'supporting',
    status: 'active',
  },
  {
    evidenceId: 'internal_e2',
    summary: 'Another lesson was completed after an earlier interruption.',
    sourceGroup: 'outcome',
    sourceGroupId: 'lesson:02',
    dependentSourceGroupIds: [],
    observedAt: '2026-07-11T00:00:00.000Z',
    strength: { score: 2, rationale: 'Explicit committed completion fact.' },
    polarity: 'supporting',
    status: 'active',
  },
];

function version(overrides: Partial<PortraitVersionView> = {}): PortraitVersionView {
  return {
    versionId: 'portrait_internal_01',
    manifestId: 'manifest_internal_01',
    state: 'completed',
    title: 'Learning continuity across contexts',
    summary: 'A bounded summary based on current evidence.',
    claims: [
      {
        claimId: 'claim_internal_01',
        markdown: 'Work was resumed across more than one lesson context.',
        evidenceIds: ['internal_e1', 'internal_e2'],
        confidence: 0.7,
        limitations: ['Only the current evidence window is covered.'],
        counterEvidenceChecked: true,
      },
    ],
    updatedAt: '2026-07-13T00:00:00.000Z',
    createdAt: '2026-07-13T00:00:00.000Z',
    resourceVersion: 3,
    ...overrides,
  };
}

describe('PortraitView', () => {
  it('renders portrait narrative Markdown without exposing source syntax', () => {
    render(
      <PortraitView
        portrait={version({
          summary:
            '**Current evidence window**\n\n- compares alternatives\n- links adjacent ideas\n\n> Tendencies remain revisable.',
        })}
        evidence={evidence}
      />,
    );

    expect(screen.getByText('Current evidence window').tagName).toBe('STRONG');
    expect(screen.getAllByRole('listitem').length).toBeGreaterThanOrEqual(3);
    expect(document.querySelector('.portrait-version-panel blockquote')).toHaveTextContent(
      'Tendencies remain revisable.',
    );
    expect(document.body).not.toHaveTextContent('**Current evidence');
  });

  it('shows generation and failed-draft states without replacing them with a fake portrait', () => {
    const { rerender } = render(
      <PortraitView portrait={version({ state: 'generating', claims: [] })} evidence={[]} />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('画像生成中');
    rerender(
      <PortraitView
        portrait={version({ state: 'failed', claims: [], errorCode: 'provider_timeout' })}
        evidence={[]}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('画像生成失败');
  });

  it('expands human-readable composite evidence without exposing internal IDs or confidence labels', () => {
    render(<PortraitView portrait={version()} evidence={evidence} />);
    expect(
      screen.getByRole('heading', { name: 'Learning continuity across contexts' }),
    ).toBeVisible();
    expect(screen.getByText(/Work was resumed/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '查看证据链 1' }));
    expect(screen.getByText(evidence[0]!.summary)).toBeVisible();
    expect(screen.getByText(/Only the current evidence window/)).toBeVisible();
    expect(document.body.textContent).not.toContain('internal_e1');
    expect(document.body.textContent).not.toContain('confidence');
    expect(document.body.textContent).not.toContain('dataKey');
  });

  it('renders an explicit insufficient state for a completed zero-claim version', () => {
    render(
      <PortraitView
        portrait={version({
          title: 'Learning Portrait V2 — Insufficient Evidence',
          summary: 'The frozen evidence pack contains no eligible evidence.',
          claims: [],
        })}
        evidence={[]}
      />,
    );
    expect(screen.getByText('学习画像：证据尚不足')).toBeVisible();
    expect(document.body).not.toHaveTextContent('Learning Portrait V2');
    expect(document.body).not.toHaveTextContent('The frozen evidence pack');
  });

  it('renders dynamic reasoning observations as evidence-bound statistics, not a fixed type label', () => {
    render(
      <PortraitView
        portrait={version({
          reasoningBehaviorAnalysis: {
            snapshot: {
              snapshotId: 'reasoning_snapshot_01',
              schemaVersion: 1,
              dimensionSetVersion: 'dimension_set_01',
              analyzerVersion: 'analyzer@1',
              sourceEpisodeIds: ['episode_01', 'episode_02'],
              filter: { courseIds: [], lessonIds: [], courseModes: [], elicitations: [] },
              eligibleEpisodeCount: 2,
              independentSourceGroupCount: 2,
              dimensions: [
                {
                  dimensionId: 'dimension_01',
                  episodeCount: 2,
                  episodeShare: 1,
                  independentSourceGroupCount: 2,
                  spontaneousCount: 1,
                  elicitedCount: 1,
                  mixedCount: 0,
                  unknownCount: 0,
                  courseCount: 1,
                  lessonCount: 1,
                },
              ],
              limitations: ['样本仍会随新的对话证据更新。'],
              sourceSnapshotHash: 'a'.repeat(64),
              createdAt: '2026-07-14T00:00:00.000Z',
              status: 'usable',
            },
            dimensions: [
              {
                dimensionId: 'dimension_01',
                dimensionSetVersion: 'dimension_set_01',
                label: '关系机制推演',
                description: '通过关系机制推进判断。',
                inclusionSignals: ['说明关系机制'],
                exclusionSignals: ['仅做并列罗列'],
                derivedFromEpisodeIds: ['episode_01', 'episode_02'],
                analyzerVersion: 'analyzer@1',
                createdAt: '2026-07-14T00:00:00.000Z',
                status: 'active',
              },
            ],
          },
        })}
        evidence={evidence}
      />,
    );

    expect(screen.getByRole('heading', { name: '思维行为观察' })).toBeVisible();
    expect(screen.getByText('关系机制推演')).toBeVisible();
    expect(screen.getByText(/已观察 2 次，来自 2 个独立来源/)).toBeVisible();
    expect(screen.getByText(/不定义人格、能力或固定学习类型/)).toBeVisible();
  });
});
