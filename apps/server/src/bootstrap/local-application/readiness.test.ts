import { describe, expect, it } from 'vitest';

import { createRuntimeReadiness } from './readiness.js';

describe('createRuntimeReadiness', () => {
  it('keeps the runtime operational when only a background projection is degraded', async () => {
    const readiness = createRuntimeReadiness({
      runtimeIdentity: undefined,
      instanceId: 'instance-0001',
      getProviderStatus: () => 'ready',
      getProjectionStatus: () => 'degraded',
    });

    await expect(readiness()).resolves.toMatchObject({
      status: 'ready',
      storeStatus: 'ready',
      projectionStatus: 'degraded',
      providerStatus: 'ready',
      reasonCode: 'background_projection_recovery_failed',
    });
  });
});
