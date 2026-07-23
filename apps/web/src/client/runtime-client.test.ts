// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  fetchServedWebBuild,
  runtimeCenterClient,
  verifyRuntimeActivation,
} from './runtime-client.js';

describe('runtime launcher client boundary', () => {
  afterEach(() => {
    sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  it('validates the capability response and the reconnect result', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            state: 'healthy',
            crashCount: 0,
            capability: 'capability_01',
            capabilityExpiresAt: Date.now() + 60_000,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ state: 'healthy', crashCount: 0 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    vi.stubGlobal('fetch', fetch);

    await expect(runtimeCenterClient.reconnect()).resolves.toEqual({
      state: 'healthy',
      crashCount: 0,
    });
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      'http://127.0.0.1:43119/control/v1/reconnect',
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-learning-more-capability': 'capability_01' }),
      }),
    );
  });

  it('rejects malformed launcher JSON instead of trusting it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ state: 'healthy', crashCount: 0, capability: 42 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    await expect(runtimeCenterClient.reconnect()).rejects.toThrow();
  });

  it('preserves a structured activation failure returned by Launcher', async () => {
    const activation = {
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
    } as const;
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              state: 'healthy',
              crashCount: 0,
              capability: 'capability_01',
              capabilityExpiresAt: Date.now() + 60_000,
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              code: 'candidate_build_failed',
              activation,
              oldRuntimeAvailable: true,
            }),
            { status: 503, headers: { 'content-type': 'application/json' } },
          ),
        ),
    );

    await expect(runtimeCenterClient.reconnect()).rejects.toMatchObject({
      message: 'candidate_build_failed',
      activation: { activeBuildId: 'build-old', attempt: 2 },
      oldRuntimeAvailable: true,
    });
  });

  it('refreshes an expired launcher capability and retries one control write', async () => {
    const expiresAt = Date.now() + 60_000;
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            state: 'healthy',
            crashCount: 0,
            capability: 'capability_01',
            capabilityExpiresAt: expiresAt,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 'control_capability_invalid' }), {
          status: 403,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            state: 'healthy',
            crashCount: 0,
            capability: 'capability_02',
            capabilityExpiresAt: expiresAt,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ state: 'healthy', crashCount: 0 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    vi.stubGlobal('fetch', fetch);

    await expect(runtimeCenterClient.reconnect()).resolves.toEqual({
      state: 'healthy',
      crashCount: 0,
    });
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(fetch).toHaveBeenNthCalledWith(
      4,
      'http://127.0.0.1:43119/control/v1/reconnect',
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-learning-more-capability': 'capability_02' }),
      }),
    );
  });

  it('ignores a stale activation record after the accepted control connection drops', async () => {
    const staleActivation = {
      schemaVersion: 2,
      requestId: 'request-old',
      phase: 'activated',
      sourceBuildId: 'build-old',
      activeBuildId: 'build-old',
      targetBuildId: 'build-old',
      attempt: 1,
      startedAt: '2026-07-15T00:00:00.000Z',
      updatedAt: '2026-07-15T00:02:00.000Z',
      completedAt: '2026-07-15T00:02:00.000Z',
    } as const;
    const freshActivation = {
      ...staleActivation,
      requestId: 'request-new',
      sourceBuildId: 'build-new',
      activeBuildId: 'build-new',
      targetBuildId: 'build-new',
      startedAt: '2026-07-16T00:00:00.000Z',
      updatedAt: '2026-07-16T00:02:00.000Z',
      completedAt: '2026-07-16T00:02:00.000Z',
    } as const;
    const launcherStatus = (activation: typeof staleActivation | typeof freshActivation) =>
      new Response(
        JSON.stringify({
          state: 'healthy',
          crashCount: 0,
          targetBuildId: activation.targetBuildId,
          activation,
          capability: 'capability_01',
          capabilityExpiresAt: Date.now() + 60_000,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(launcherStatus(staleActivation))
      .mockRejectedValueOnce(new TypeError('connection closed'))
      .mockResolvedValueOnce(launcherStatus(staleActivation))
      .mockResolvedValueOnce(launcherStatus(freshActivation));
    vi.stubGlobal('fetch', fetch);

    await expect(runtimeCenterClient.reconnect()).resolves.toMatchObject({
      targetBuildId: 'build-new',
      activation: { requestId: 'request-new' },
    });
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('reads the no-store served Web identity from the stable build metadata path', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ schemaVersion: 1, buildId: 'build-new', protocolVersion: '1' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    vi.stubGlobal('fetch', fetch);

    await expect(fetchServedWebBuild()).resolves.toEqual({
      schemaVersion: 1,
      buildId: 'build-new',
      protocolVersion: '1',
    });
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/^\/build-meta\.json\?operation=/u),
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  it('rejects an activated Runtime when the served Web build remains old', async () => {
    const activation = {
      schemaVersion: 2,
      requestId: 'request-01',
      phase: 'activated',
      sourceBuildId: 'build-new',
      activeBuildId: 'build-new',
      targetBuildId: 'build-new',
      attempt: 1,
      startedAt: '2026-07-16T00:00:00.000Z',
      updatedAt: '2026-07-16T00:02:00.000Z',
      completedAt: '2026-07-16T00:02:00.000Z',
    } as const;
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            state: 'healthy',
            crashCount: 0,
            targetBuildId: 'build-new',
            activation,
            capability: 'capability_01',
            capabilityExpiresAt: Date.now() + 60_000,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ schemaVersion: 1, buildId: 'build-old', protocolVersion: '1' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    vi.stubGlobal('fetch', fetch);

    await expect(
      verifyRuntimeActivation('build-new', {
        status: 'ready',
        instanceId: 'instance-new',
        buildId: 'build-new',
        protocolVersion: '1',
        storeStatus: 'ready',
        projectionStatus: 'ready',
        providerStatus: 'ready',
      }),
    ).rejects.toThrow('served_web_build_mismatch');
  });

  it('loads the dynamic Provider catalog from the Server contract', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          providers: [
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
                  supportedReasoningEfforts: ['low', 'ultra'],
                },
              ],
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetch);

    await expect(runtimeCenterClient.getProviderCatalog({ refresh: true })).resolves.toMatchObject({
      providers: [{ providerId: 'codex-cli', models: [{ id: 'gpt-5.6-sol' }] }],
    });
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/ai-runtime/providers?refresh=true',
      expect.objectContaining({ headers: { accept: 'application/json' } }),
    );
  });

  it('starts the Codex browser login flow through a CSRF-protected Server command', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ state: 'started' }), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetch);

    await expect(runtimeCenterClient.startCodexLogin?.()).resolves.toEqual({ state: 'started' });
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/ai-runtime/providers/codex-cli/login',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-csrf-token': 'development-csrf' }),
        body: '{}',
      }),
    );
  });
});
