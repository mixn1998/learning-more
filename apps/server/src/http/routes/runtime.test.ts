import {
  CodexLoginStartResponseSchema,
  ProviderCatalogSchema,
  ProviderSwitchResponseSchema,
} from '@learning-more/contracts';
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerLocalSecurity } from '../plugins/local-security.js';
import { registerRuntimeRoutes } from './runtime.js';

describe('AI runtime routes', () => {
  const apps: ReturnType<typeof Fastify>[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it('switches through the typed service and returns no config or secret material', async () => {
    const app = Fastify();
    apps.push(app);
    const switchProvider = vi.fn().mockResolvedValue({
      providerId: 'api',
      capabilities: {
        id: 'api',
        kind: 'api',
        maxConcurrency: 2,
        supportsStreaming: true,
      },
      health: { status: 'healthy' },
    });
    const createDiagnostics = vi.fn().mockResolvedValue({ artifactRef: 'diagnostics_01' });
    const getProviderCatalog = vi.fn().mockResolvedValue({
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
    });
    const startProviderAuthentication = vi.fn().mockResolvedValue({ state: 'started' });
    await registerLocalSecurity(app, {
      allowedOrigin: 'http://127.0.0.1:5173',
      csrfToken: 'csrf',
    });
    await registerRuntimeRoutes(app, {
      switchProvider,
      createDiagnostics,
      getProviderCatalog,
      startProviderAuthentication,
      getProviderStatus: vi.fn().mockResolvedValue({
        providerId: 'api',
        model: 'model-01',
        reasoningEffort: 'high',
        configurationState: 'applied',
        capabilities: {
          id: 'api',
          kind: 'api',
          maxConcurrency: 2,
          supportsStreaming: true,
        },
        health: { status: 'healthy' },
      }),
    });
    const status = await app.inject({
      method: 'GET',
      url: '/api/v1/ai-runtime/status',
      headers: { host: '127.0.0.1:43120', origin: 'http://127.0.0.1:5173' },
    });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({
      providerId: 'api',
      model: 'model-01',
      reasoningEffort: 'high',
      configurationState: 'applied',
      health: { status: 'healthy' },
    });
    const catalog = await app.inject({
      method: 'GET',
      url: '/api/v1/ai-runtime/providers?refresh=true',
      headers: { host: '127.0.0.1:43120', origin: 'http://127.0.0.1:5173' },
    });
    expect(catalog.statusCode).toBe(200);
    expect(ProviderCatalogSchema.parse(catalog.json())).toEqual(catalog.json());
    expect(getProviderCatalog).toHaveBeenCalledWith({ refresh: true });
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/ai-runtime/providers/codex-cli/login',
      headers: {
        host: '127.0.0.1:43120',
        origin: 'http://127.0.0.1:5173',
        'x-csrf-token': 'csrf',
      },
      payload: {},
    });
    expect(login.statusCode).toBe(202);
    expect(CodexLoginStartResponseSchema.parse(login.json())).toEqual({ state: 'started' });
    expect(startProviderAuthentication).toHaveBeenCalledWith('codex-cli');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/ai-runtime/provider-switches',
      headers: {
        host: '127.0.0.1:43120',
        origin: 'http://127.0.0.1:5173',
        'x-csrf-token': 'csrf',
      },
      payload: {
        providerId: 'api',
        publicConfig: { model: 'model-01' },
        secretHandles: { apiKey: 'sanitized-secret-49845ef5c5a6' },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(ProviderSwitchResponseSchema.parse(response.json())).toEqual(response.json());
    expect(response.body).not.toContain('model-01');
    expect(response.body).not.toContain('sanitized-secret-49845ef5c5a6');
    expect(switchProvider).toHaveBeenCalledWith({
      providerId: 'api',
      publicConfig: { model: 'model-01' },
      secretHandles: { apiKey: 'sanitized-secret-49845ef5c5a6' },
    });
    const diagnostics = await app.inject({
      method: 'POST',
      url: '/api/v1/runtime/diagnostics',
      headers: {
        host: '127.0.0.1:43120',
        origin: 'http://127.0.0.1:5173',
        'x-csrf-token': 'csrf',
      },
      payload: {},
    });
    expect(diagnostics.statusCode).toBe(201);
    expect(diagnostics.json()).toEqual({ artifactRef: 'diagnostics_01' });
  });

  it('rejects undeclared secret input and missing CSRF', async () => {
    const app = Fastify();
    apps.push(app);
    await registerLocalSecurity(app, {
      allowedOrigin: 'http://127.0.0.1:5173',
      csrfToken: 'csrf',
    });
    await registerRuntimeRoutes(app, { switchProvider: vi.fn() });
    const payload = {
      providerId: 'api',
      publicConfig: {},
      secretHandles: {},
      apiKey: 'sanitized-secret-77a0d7a96979',
    };
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/ai-runtime/provider-switches',
          headers: { host: '127.0.0.1:43120', origin: 'http://127.0.0.1:5173' },
          payload,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/ai-runtime/provider-switches',
          headers: {
            host: '127.0.0.1:43120',
            origin: 'http://127.0.0.1:5173',
            'x-csrf-token': 'csrf',
          },
          payload,
        })
      ).statusCode,
    ).toBe(400);
  });
});
