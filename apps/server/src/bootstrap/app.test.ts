import { describe, expect, it, vi } from 'vitest';

import { buildApp } from './app.js';

describe('buildApp lifecycle', () => {
  it('registers close hooks before Fastify becomes ready', async () => {
    const onClose = vi.fn().mockResolvedValue(undefined);
    const app = await buildApp(
      {
        getRuntimeReadiness: async () => ({
          status: 'ready',
          instanceId: 'instance_01',
          buildId: 'development',
          protocolVersion: '1',
          storeStatus: 'ready',
          projectionStatus: 'ready',
          providerStatus: 'unconfigured',
        }),
      },
      { onClose },
    );
    await expect(app.close()).resolves.toBeUndefined();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
