// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import type { PortraitVersion } from '@learning-more/contracts';

import type { ProfileClient } from '../../client/profile-client.js';
import { ProfilePage } from './profile-page.js';

afterEach(cleanup);

function version(overrides: Partial<PortraitVersion> = {}): PortraitVersion {
  return {
    versionId: 'portrait_1',
    manifestId: 'manifest_1',
    state: 'completed',
    title: '从行为证据修正判断',
    summary: '当前画像只覆盖近期两个独立学习情境。',
    claims: [
      {
        claimId: 'claim_1',
        markdown: '### 会检查行动是否改变\n\n你会用后续行为修正最初解释。',
        evidenceIds: ['evidence_1'],
        confidence: 0.7,
        limitations: ['只覆盖当前证据窗口。'],
        counterEvidenceChecked: true,
      },
    ],
    createdAt: '2026-07-12T00:00:00.000Z',
    updatedAt: '2026-07-12T00:00:00.000Z',
    resourceVersion: 1,
    ...overrides,
  };
}

function client(overrides: Partial<ProfileClient> = {}): ProfileClient {
  return {
    getProfile: vi.fn().mockResolvedValue({ profileSchemaVersion: 1 }),
    getEvidence: vi.fn().mockResolvedValue([
      {
        evidenceId: 'evidence_1',
        summary: '完成课节后根据结果修改了原解释。',
        sourceGroup: 'behavior',
        sourceGroupId: 'lesson:1',
        dependentSourceGroupIds: [],
        observedAt: '2026-07-11T00:00:00.000Z',
        strength: { score: 2, rationale: 'committed fact' },
        polarity: 'supporting',
        status: 'active',
      },
    ]),
    getPortrait: vi.fn().mockResolvedValue(version()),
    getPortraitVersion: vi.fn().mockResolvedValue(undefined),
    refresh: vi.fn().mockResolvedValue(
      version({
        versionId: 'portrait_2',
        title: '刷新后的有边界观察',
        updatedAt: '2026-07-14T00:00:00.000Z',
        resourceVersion: 2,
      }),
    ),
    ...overrides,
  };
}

describe('ProfilePage', () => {
  it('projects the completed portrait into the approved workspace and opens traceable evidence inline', async () => {
    const api = client();
    render(
      <MemoryRouter initialEntries={['/profile']}>
        <ProfilePage client={api} />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: '学习画像' })).toBeVisible();
    expect(screen.getByRole('heading', { name: '从行为证据修正判断' })).toBeVisible();
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      '历史统计',
      '学习日历',
      '学习画像',
    ]);
    expect(screen.getByRole('heading', { name: '你在学习中反复出现的做法' })).toBeVisible();
    fireEvent.click(screen.getByText('这条观察从哪里来'));
    expect(screen.getByText('在这次学习中，你也出现了与上面描述相符的做法。')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('完成课节后根据结果修改了原解释。');
    expect(document.body.textContent).not.toContain('evidence_1');
    expect(document.body.textContent).not.toContain('confidence');
  });

  it('keeps the real refresh command wired and swaps in the returned completed version', async () => {
    const api = client();
    render(
      <MemoryRouter initialEntries={['/profile']}>
        <ProfilePage client={api} />
      </MemoryRouter>,
    );
    await screen.findByRole('heading', { name: '从行为证据修正判断' });

    fireEvent.click(screen.getByRole('button', { name: '刷新画像' }));

    expect(await screen.findByRole('heading', { name: '刷新后的有边界观察' })).toBeVisible();
    expect(api.refresh).toHaveBeenCalledTimes(1);
  });

  it('reuses the static snapshot across tab remounts without refreshing or reloading evidence', async () => {
    const api = client();
    const first = render(
      <MemoryRouter initialEntries={['/history?tab=portrait']}>
        <ProfilePage client={api} />
      </MemoryRouter>,
    );
    await screen.findByRole('heading', { name: '从行为证据修正判断' });
    first.unmount();

    render(
      <MemoryRouter initialEntries={['/history?tab=portrait']}>
        <ProfilePage client={api} />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: '从行为证据修正判断' })).toBeVisible();
    await waitFor(() => expect(api.getPortrait).toHaveBeenCalledTimes(2));
    expect(api.getEvidence).toHaveBeenCalledTimes(1);
    expect(api.refresh).not.toHaveBeenCalled();
  });

  it('localizes a completed zero-insight portrait instead of replaying legacy English fallback copy', async () => {
    const legacyEnglishPortrait = version({
      title: 'Learning Portrait V2 — Insufficient Evidence',
      summary: 'The frozen evidence pack contains no eligible evidence IDs or evidence records.',
      claims: [],
    });
    render(
      <MemoryRouter initialEntries={['/profile']}>
        <ProfilePage
          client={client({ getPortrait: vi.fn().mockResolvedValue(legacyEnglishPortrait) })}
        />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: '学习画像：证据尚不足' })).toBeVisible();
    expect(screen.getByText(/当前冻结的证据尚不足以形成可独立验证的学习观察/)).toBeVisible();
    expect(document.body).not.toHaveTextContent('Learning Portrait V2');
    expect(document.body).not.toHaveTextContent('The frozen evidence pack');
  });

  it('keeps the approved portrait workspace when generation failed instead of falling back to the legacy page', async () => {
    render(
      <MemoryRouter initialEntries={['/history?tab=portrait']}>
        <ProfilePage
          client={client({
            getPortrait: vi
              .fn()
              .mockResolvedValue(
                version({ state: 'failed', claims: [], errorCode: 'portrait_refresh_failed' }),
              ),
          })}
          embedded
        />
      </MemoryRouter>,
    );

    expect(await screen.findByText('LEARNING PORTRAIT')).toBeVisible();
    expect(document.querySelector('.portrait-workspace')).toBeInTheDocument();
    expect(document.querySelector('.portrait-board')).toBeInTheDocument();
    expect(document.querySelector('.portrait-summary')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('画像生成失败');
    expect(document.body).not.toHaveTextContent('portrait_refresh_failed');
  });
});
