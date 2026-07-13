// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RuntimeStateContext, type RuntimeUiState } from '../../state/version-guard.js';
import { RuntimeCenter } from './runtime-center.js';

const state: RuntimeUiState = {
  kind: 'loaded',
  readiness: {
    status: 'ready',
    instanceId: 'instance_public_01',
    buildId: 'build_01',
    protocolVersion: '1',
    storeStatus: 'ready',
    projectionStatus: 'ready',
    providerStatus: 'ready',
    generation: 2,
    identityFingerprint: 'a'.repeat(64),
  },
  version: { kind: 'compatible', writesAllowed: true },
};

describe('RuntimeCenter', () => {
  afterEach(cleanup);

  it('shows only public identity and executes the four controlled reconnect stages', async () => {
    const reconnect = vi.fn().mockResolvedValue({ state: 'healthy' });
    const waitUntilReady = vi.fn().mockResolvedValue(state.readiness);
    const refreshAi = vi.fn().mockResolvedValue(undefined);
    const switchProvider = vi.fn().mockResolvedValue(undefined);
    const getProviderStatus = vi.fn().mockResolvedValue({
      providerId: 'api',
      model: 'model-01',
      capabilities: {
        id: 'api',
        kind: 'api',
        maxConcurrency: 2,
        supportsStreaming: true,
      },
      health: { status: 'healthy' },
    });
    render(
      <RuntimeStateContext.Provider value={{ state, refresh: vi.fn() }}>
        <RuntimeCenter
          api={{ reconnect, waitUntilReady, refreshAi, switchProvider, getProviderStatus }}
        />
      </RuntimeStateContext.Provider>,
    );
    expect(screen.getByText('instance_public_01')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('dataRoot');
    expect(document.body.textContent).not.toContain('secret');
    fireEvent.click(screen.getByRole('button', { name: '安全重连' }));
    expect(await screen.findByText('刷新 AI：完成')).toBeInTheDocument();
    expect(reconnect).toHaveBeenCalledTimes(1);
    expect(waitUntilReady).toHaveBeenCalledTimes(1);
    expect(refreshAi).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('model-01')).toBeInTheDocument();
  });
});
