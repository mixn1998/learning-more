import { describe, expect, it, vi } from 'vitest';
import { request } from 'node:http';

import { buildControlServer } from './control-server.js';

describe('Launcher control server', () => {
  it('allows status but requires exact loopback origin and short-lived capability for writes', async () => {
    const reconnect = vi.fn().mockResolvedValue({ state: 'healthy' });
    const syncFrontend = vi.fn().mockResolvedValue({ state: 'healthy' });
    const diagnose = vi.fn().mockResolvedValue({ artifactRef: 'diagnostics_01' });
    const app = await buildControlServer({
      allowedOrigin: 'http://127.0.0.1:5173',
      capability: { value: 'capability_01', expiresAt: Date.now() + 60_000 },
      getStatus: async () => ({ state: 'healthy' }),
      reconnect,
      syncFrontend,
      diagnose,
    });
    const common = { host: '127.0.0.1:43119', origin: 'http://127.0.0.1:5173' };
    expect(
      (await app.inject({ method: 'GET', url: '/control/v1/status', headers: common })).statusCode,
    ).toBe(200);
    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/control/v1/reconnect',
      headers: common,
    });
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers['access-control-allow-origin']).toBe(common.origin);
    expect(preflight.headers['access-control-allow-headers']).toContain(
      'x-learning-more-capability',
    );
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/control/v1/reconnect',
          headers: common,
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/control/v1/reconnect',
          headers: {
            ...common,
            origin: 'http://evil.invalid',
            'x-learning-more-capability': 'capability_01',
          },
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
    const authorized = { ...common, 'x-learning-more-capability': 'capability_01' };
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/control/v1/reconnect',
          headers: authorized,
          payload: {},
        })
      ).statusCode,
    ).toBe(200);
    expect(reconnect).toHaveBeenCalledTimes(1);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/control/v1/sync-frontend',
          headers: authorized,
          payload: {},
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/control/v1/diagnose',
          headers: authorized,
          payload: { command: 'whoami' },
        })
      ).statusCode,
    ).toBe(400);
    await app.close();
  });

  it('binds only to loopback and applies the same policy to real HTTP requests', async () => {
    const app = await buildControlServer({
      allowedOrigin: 'http://127.0.0.1:5173',
      capability: { value: 'capability_01', expiresAt: Date.now() + 60_000 },
      getStatus: async () => ({ state: 'healthy' }),
      reconnect: async () => ({ state: 'healthy' }),
      syncFrontend: async () => ({ state: 'healthy' }),
      diagnose: async () => ({ artifactRef: 'diagnostics_01' }),
    });
    const url = await app.listen({ port: 0 });
    const result = await new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
      const outgoing = request(
        `${url}/control/v1/status`,
        {
          headers: {
            host: '127.0.0.1:43119',
            origin: 'http://127.0.0.1:5173',
          },
        },
        (incoming) => {
          const chunks: Buffer[] = [];
          incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
          incoming.on('end', () =>
            resolve({
              statusCode: incoming.statusCode ?? 0,
              body: Buffer.concat(chunks).toString('utf8'),
            }),
          );
        },
      );
      outgoing.on('error', reject);
      outgoing.end();
    });
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ state: 'healthy' });
    await app.close();
  });
});
