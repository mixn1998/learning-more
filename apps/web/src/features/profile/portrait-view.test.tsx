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
    resourceVersion: 3,
    ...overrides,
  };
}

describe('PortraitView', () => {
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
      <PortraitView portrait={version({ title: '学习画像证据不足', claims: [] })} evidence={[]} />,
    );
    expect(screen.getByText('证据不足，暂不生成稳定洞察')).toBeVisible();
  });
});
