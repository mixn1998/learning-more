// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import { runtimeCenterClient } from './runtime-client.js';

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
