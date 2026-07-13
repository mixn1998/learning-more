import { ProviderSwitchResponseSchema } from '@learning-more/contracts';
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
    await registerLocalSecurity(app, {
      allowedOrigin: 'http://127.0.0.1:5173',
      csrfToken: 'csrf',
    });
    await registerRuntimeRoutes(app, { switchProvider });
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
        secretHandles: { apiKey: 'provider/api-key' },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(ProviderSwitchResponseSchema.parse(response.json())).toEqual(response.json());
    expect(response.body).not.toContain('model-01');
    expect(response.body).not.toContain('provider/api-key');
    expect(switchProvider).toHaveBeenCalledWith({
      providerId: 'api',
      publicConfig: { model: 'model-01' },
      secretHandles: { apiKey: 'provider/api-key' },
    });
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
      apiKey: 'plaintext-forbidden',
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
