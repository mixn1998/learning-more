// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ProviderCatalog, ProviderRuntimeStatus } from '@learning-more/contracts';

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

const providerStatus = {
  providerId: 'api',
  model: 'model-01',
  configurationState: 'applied',
  capabilities: {
    id: 'api',
    kind: 'api',
    maxConcurrency: 2,
    supportsStreaming: true,
  },
  health: { status: 'healthy' },
} satisfies ProviderRuntimeStatus;

const providerCatalog = {
  providers: [
    {
      providerId: 'mock',
      capabilities: {
        id: 'mock',
        kind: 'mock',
        maxConcurrency: 8,
        supportsStreaming: true,
      },
      health: { status: 'healthy' },
      models: [],
    },
    {
      providerId: 'api',
      capabilities: {
        id: 'api',
        kind: 'api',
        maxConcurrency: 2,
        supportsStreaming: true,
      },
      health: { status: 'healthy' },
      models: [],
    },
    {
      providerId: 'codex-cli',
      capabilities: {
        id: 'codex-cli',
        kind: 'cli',
        maxConcurrency: 2,
        supportsStreaming: true,
      },
      health: { status: 'healthy' },
      models: [
        {
          id: 'gpt-5.6-sol',
          displayName: 'GPT-5.6-Sol',
          defaultReasoningEffort: 'low',
          supportedReasoningEfforts: ['low', 'medium', 'high', 'ultra'],
        },
      ],
    },
  ],
} satisfies ProviderCatalog;

function CurrentPath() {
  return <output data-testid="current-path">{useLocation().pathname}</output>;
}

describe('RuntimeCenter', () => {
  afterEach(cleanup);

  it('returns to the page that opened the runtime center when it is closed', () => {
    render(
      <MemoryRouter initialEntries={['/notes', '/runtime']} initialIndex={1}>
        <CurrentPath />
        <RuntimeStateContext.Provider value={{ state, refresh: vi.fn() }}>
          <RuntimeCenter
            api={{
              reconnect: vi.fn(),
              waitUntilReady: vi.fn(),
              refreshAi: vi.fn(),
              switchProvider: vi.fn(),
              getProviderStatus: vi.fn().mockResolvedValue(providerStatus),
              getProviderCatalog: vi.fn().mockResolvedValue(providerCatalog),
              createDiagnostics: vi.fn(),
            }}
          />
        </RuntimeStateContext.Provider>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: '关闭' }));

    expect(screen.getByTestId('current-path')).toHaveTextContent('/notes');
  });

  it('does not label the local service healthy while the shared recovery state is failed', async () => {
    render(
      <MemoryRouter>
        <RuntimeStateContext.Provider
          value={{
            state,
            refresh: vi.fn(),
            recovery: {
              kind: 'failed',
              operationId: 1,
              reason: 'runtime_ready_timeout',
              aiRecoveryFailed: false,
            },
          }}
        >
          <RuntimeCenter
            api={{
              reconnect: vi.fn(),
              waitUntilReady: vi.fn(),
              refreshAi: vi.fn(),
              switchProvider: vi.fn(),
              getProviderStatus: vi.fn().mockResolvedValue(providerStatus),
              getProviderCatalog: vi.fn().mockResolvedValue(providerCatalog),
              createDiagnostics: vi.fn(),
            }}
          />
        </RuntimeStateContext.Provider>
      </MemoryRouter>,
    );

    const serviceTab = screen.getByRole('tab', { name: /本地服务/ });
    expect(serviceTab).toHaveTextContent('异常');
    expect(serviceTab).not.toHaveTextContent('健康');
  });

  it('shows the stable activation failure and whether the old Runtime remains available', async () => {
    render(
      <MemoryRouter>
        <RuntimeStateContext.Provider
          value={{
            state,
            refresh: vi.fn(),
            recovery: {
              kind: 'failed',
              operationId: 2,
              reason: 'candidate_build_failed',
              aiRecoveryFailed: false,
              oldRuntimeAvailable: true,
              activation: {
                schemaVersion: 2,
                requestId: 'request-01',
                phase: 'failed',
                sourceBuildId: 'build-new',
                activeBuildId: 'build-old',
                targetBuildId: 'build-new',
                attempt: 2,
                errorCode: 'candidate_build_failed',
                errorStage: 'building',
                startedAt: '2026-07-16T00:00:00.000Z',
                updatedAt: '2026-07-16T00:02:00.000Z',
                completedAt: '2026-07-16T00:02:00.000Z',
              },
            },
          }}
        >
          <RuntimeCenter
            api={{
              reconnect: vi.fn(),
              waitUntilReady: vi.fn(),
              refreshAi: vi.fn(),
              switchProvider: vi.fn(),
              getProviderStatus: vi.fn().mockResolvedValue(providerStatus),
              getProviderCatalog: vi.fn().mockResolvedValue(providerCatalog),
              createDiagnostics: vi.fn(),
            }}
          />
        </RuntimeStateContext.Provider>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('tab', { name: /本地服务/ }));
    expect(screen.getByRole('alert')).toHaveTextContent('候选版本连续两次构建失败');
    expect(screen.getByRole('alert')).toHaveTextContent('旧版本仍可使用');
  });

  it('routes frontend synchronization through the shared local recovery flow', async () => {
    const recover = vi.fn().mockResolvedValue(undefined);
    const refreshAi = vi.fn();
    render(
      <MemoryRouter>
        <RuntimeStateContext.Provider value={{ state, refresh: vi.fn(), recover }}>
          <RuntimeCenter
            api={{
              reconnect: vi.fn(),
              waitUntilReady: vi.fn(),
              refreshAi,
              switchProvider: vi.fn(),
              getProviderStatus: vi.fn().mockResolvedValue(providerStatus),
              getProviderCatalog: vi.fn().mockResolvedValue(providerCatalog),
              createDiagnostics: vi.fn(),
            }}
          />
        </RuntimeStateContext.Provider>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('tab', { name: /本地服务/ }));
    fireEvent.click(screen.getByRole('button', { name: '同步前端版本' }));
    await waitFor(() => expect(recover).toHaveBeenCalledOnce());
    expect(refreshAi).not.toHaveBeenCalled();
  });

  it('keeps the applied high effort after reopening and selecting the current Provider', async () => {
    const highStatus = {
      ...providerStatus,
      providerId: 'codex-cli',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'high',
      capabilities: providerCatalog.providers[2]!.capabilities,
    } satisfies ProviderRuntimeStatus;

    render(
      <MemoryRouter>
        <RuntimeStateContext.Provider value={{ state, refresh: vi.fn() }}>
          <RuntimeCenter
            api={{
              reconnect: vi.fn(),
              waitUntilReady: vi.fn(),
              refreshAi: vi.fn(),
              switchProvider: vi.fn(),
              getProviderStatus: vi.fn().mockResolvedValue(highStatus),
              getProviderCatalog: vi.fn().mockResolvedValue(providerCatalog),
              createDiagnostics: vi.fn(),
            }}
          />
        </RuntimeStateContext.Provider>
      </MemoryRouter>,
    );

    expect(await screen.findByLabelText(/推理强度/)).toHaveValue('high');
    fireEvent.click(screen.getByRole('button', { name: /Codex CLI 当前使用/ }));
    expect(screen.getByLabelText(/推理强度/)).toHaveValue('high');
  });

  it('shows a truthful connecting state until the first live snapshot arrives', async () => {
    let resolveStatus!: (value: typeof providerStatus) => void;
    let resolveCatalog!: (value: typeof providerCatalog) => void;
    const getProviderStatus = vi.fn(
      () => new Promise<typeof providerStatus>((resolve) => (resolveStatus = resolve)),
    );
    const getProviderCatalog = vi.fn(
      () => new Promise<typeof providerCatalog>((resolve) => (resolveCatalog = resolve)),
    );

    render(
      <MemoryRouter>
        <RuntimeStateContext.Provider value={{ state, refresh: vi.fn() }}>
          <RuntimeCenter
            api={{
              reconnect: vi.fn(),
              waitUntilReady: vi.fn(),
              refreshAi: vi.fn(),
              switchProvider: vi.fn(),
              getProviderStatus,
              getProviderCatalog,
              createDiagnostics: vi.fn(),
            }}
          />
        </RuntimeStateContext.Provider>
      </MemoryRouter>,
    );

    expect(screen.getAllByText(/连接中/).length).toBeGreaterThan(0);
    await act(async () => {
      resolveStatus(providerStatus);
      resolveCatalog(providerCatalog);
    });
    expect(await screen.findByText(/API-compatible · 已连接/)).toBeInTheDocument();
  });

  it('polls live provider status and catalog while the runtime center remains open', async () => {
    const getProviderStatus = vi.fn().mockResolvedValue(providerStatus);
    const getProviderCatalog = vi.fn().mockResolvedValue(providerCatalog);

    render(
      <MemoryRouter>
        <RuntimeStateContext.Provider value={{ state, refresh: vi.fn() }}>
          <RuntimeCenter
            api={{
              reconnect: vi.fn(),
              waitUntilReady: vi.fn(),
              refreshAi: vi.fn(),
              switchProvider: vi.fn(),
              getProviderStatus,
              getProviderCatalog,
              createDiagnostics: vi.fn(),
            }}
            pollIntervalMs={20}
          />
        </RuntimeStateContext.Provider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(getProviderStatus.mock.calls.length).toBeGreaterThan(1));
    expect(getProviderCatalog.mock.calls.length).toBeGreaterThan(1);
  });

  it('shows only public identity and executes the four controlled reconnect stages', async () => {
    const reconnect = vi.fn().mockResolvedValue({ state: 'healthy', crashCount: 0 });
    const waitUntilReady = vi.fn().mockResolvedValue(state.readiness);
    const refreshAi = vi.fn().mockResolvedValue(undefined);
    const switchProvider = vi.fn().mockResolvedValue(providerStatus);
    const getProviderStatus = vi.fn().mockResolvedValue(providerStatus);
    const getProviderCatalog = vi.fn().mockResolvedValue(providerCatalog);
    const createDiagnostics = vi.fn().mockResolvedValue({ diagnosticId: 'diagnostics_public_01' });

    render(
      <MemoryRouter>
        <RuntimeStateContext.Provider value={{ state, refresh: vi.fn() }}>
          <RuntimeCenter
            api={{
              reconnect,
              waitUntilReady,
              refreshAi,
              switchProvider,
              getProviderStatus,
              getProviderCatalog,
              createDiagnostics,
            }}
          />
        </RuntimeStateContext.Provider>
      </MemoryRouter>,
    );

    expect(screen.getByText('instance_public_01')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('dataRoot');
    expect(document.body.textContent).not.toContain('secret');

    fireEvent.click(screen.getByRole('tab', { name: /本地服务/ }));
    fireEvent.click(screen.getByRole('button', { name: '安全重连' }));
    const refreshStage = await screen.findByText('4. 刷新 AI');
    expect(refreshStage.closest('li')).toHaveTextContent('完成');
    expect(reconnect).toHaveBeenCalledTimes(1);
    expect(waitUntilReady).toHaveBeenCalledTimes(1);
    expect(refreshAi).toHaveBeenCalledTimes(1);
    expect((await screen.findAllByText('model-01')).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: '生成诊断制品' }));
    expect(await screen.findByText(/diagnostics_public_01/)).toBeInTheDocument();
  });

  it('renders only live Codex models and submits the selected reasoning effort', async () => {
    const switchProvider = vi.fn().mockResolvedValue({
      providerId: 'codex-cli',
      capabilities: providerCatalog.providers[2]!.capabilities,
      health: { status: 'healthy' },
    });
    const getProviderStatus = vi.fn().mockResolvedValue(providerStatus);

    render(
      <MemoryRouter>
        <RuntimeStateContext.Provider value={{ state, refresh: vi.fn() }}>
          <RuntimeCenter
            api={{
              reconnect: vi.fn(),
              waitUntilReady: vi.fn(),
              refreshAi: vi.fn(),
              switchProvider,
              getProviderStatus,
              getProviderCatalog: vi.fn().mockResolvedValue(providerCatalog),
              createDiagnostics: vi.fn(),
            }}
          />
        </RuntimeStateContext.Provider>
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: /Codex CLI/ }));
    expect(document.body.textContent).not.toContain('gpt-5.6-luna');
    expect(document.body.textContent).not.toContain('gpt-5.5-luna');
    expect(screen.getByLabelText('连接状态')).toHaveValue('可用 · 未连接（需切换）');
    expect(screen.getByRole('button', { name: /Codex CLI/ })).toHaveTextContent('可用 · 未连接');
    expect(screen.queryByRole('button', { name: '启动并检查' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'GPT-5.6-Sol' })).toHaveValue('gpt-5.6-sol');
    expect(screen.getByLabelText(/推理强度/)).toHaveAccessibleName(/模型默认 low，可调整/);
    fireEvent.change(screen.getByLabelText(/推理强度/), { target: { value: 'ultra' } });
    fireEvent.click(screen.getByRole('button', { name: '连接并切换' }));

    expect(switchProvider).toHaveBeenCalledWith(
      {
        providerId: 'codex-cli',
        publicConfig: { model: 'gpt-5.6-sol', reasoningEffort: 'ultra' },
        secretHandles: {},
      },
      expect.anything(),
    );
  });

  it('starts browser authentication and automatically loads models after verification', async () => {
    const unauthenticatedCatalog = {
      ...providerCatalog,
      providers: providerCatalog.providers.map((entry) =>
        entry.providerId === 'codex-cli'
          ? {
              ...entry,
              health: {
                status: 'unhealthy' as const,
                message: 'codex_cli_not_authenticated',
              },
              models: [],
            }
          : entry,
      ),
    };
    const getProviderCatalog = vi
      .fn()
      .mockResolvedValueOnce(unauthenticatedCatalog)
      .mockResolvedValue(providerCatalog);
    const startCodexLogin = vi.fn().mockResolvedValue({ state: 'started' });

    render(
      <MemoryRouter>
        <RuntimeStateContext.Provider value={{ state, refresh: vi.fn() }}>
          <RuntimeCenter
            api={{
              reconnect: vi.fn(),
              waitUntilReady: vi.fn(),
              refreshAi: vi.fn(),
              switchProvider: vi.fn(),
              getProviderStatus: vi.fn().mockResolvedValue(providerStatus),
              getProviderCatalog,
              startCodexLogin,
              createDiagnostics: vi.fn(),
            }}
          />
        </RuntimeStateContext.Provider>
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: /Codex CLI/ }));
    fireEvent.click(screen.getByRole('button', { name: '登录 Codex' }));

    expect(startCodexLogin).toHaveBeenCalledOnce();
    expect(await screen.findByRole('option', { name: 'GPT-5.6-Sol' })).toBeInTheDocument();
    expect(getProviderCatalog).toHaveBeenLastCalledWith({ refresh: true });
  });
});
