import { RuntimeReadySchema } from '@learning-more/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp, type ServerDependencies } from '../../bootstrap/app.js';

const readiness = {
  status: 'ready',
  instanceId: 'instance-0001',
  buildId: 'development',
  protocolVersion: '1',
  storeStatus: 'ready',
  projectionStatus: 'ready',
  providerStatus: 'unconfigured',
  generation: 2,
  startedAt: '2026-07-13T00:00:00.000Z',
  identityFingerprint: 'a'.repeat(64),
  reasonCode: 'provider_unconfigured',
} as const;

describe('GET /api/v1/runtime/ready', () => {
  const apps: Awaited<ReturnType<typeof buildApp>>[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  async function createApp(overrides: Partial<ServerDependencies> = {}) {
    const app = await buildApp({
      getRuntimeReadiness: async () => readiness,
      ...overrides,
    });
    apps.push(app);
    return app;
  }

  it('returns the strict public readiness contract', async () => {
    const app = await createApp();

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/runtime/ready',
    });

    expect(response.statusCode).toBe(200);
    expect(RuntimeReadySchema.parse(response.json())).toEqual(readiness);
    expect(response.body).not.toContain('dataRoot');
    expect(response.body).not.toContain('secret');
  });

  it('does not serialize undeclared dependency fields', async () => {
    const app = await createApp({
      getRuntimeReadiness: async () => ({ ...readiness, dataRoot: 'D:\\private' }),
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/runtime/ready',
    });

    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('D:\\private');
  });
});
