// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './app.js';
import { RuntimeStatusCards } from './layouts/app-shell.js';

const degradedReadiness = {
  status: 'degraded',
  instanceId: 'instance-0001',
  buildId: 'development',
  protocolVersion: '1',
  storeStatus: 'degraded',
  projectionStatus: 'ready',
  providerStatus: 'unconfigured',
} as const;

describe('App runtime readiness', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows the degraded state returned by the local server', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(degradedReadiness), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    expect(await screen.findByRole('alert')).toHaveTextContent('数据需要修复');
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/runtime/ready', {
      headers: { accept: 'application/json' },
      signal: expect.any(AbortSignal),
    });
  });

  it('offers a retry when the local server cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));

    render(<App />);

    expect(await screen.findByRole('alert')).toHaveTextContent('无法连接本地服务');
    expect(screen.getByRole('button', { name: '重试连接' })).toBeEnabled();
  });

  it('shows controlled recovery as reconnecting instead of needing attention', () => {
    render(
      <MemoryRouter>
        <RuntimeStatusCards
          providerLabel="Codex CLI"
          providerReady
          recovering
          status="rebuilding"
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: /本地服务/ })).toHaveTextContent('本地服务 · 重连中');
    expect(screen.getByRole('link', { name: /本地服务/ })).not.toHaveTextContent('需要处理');
  });
});
