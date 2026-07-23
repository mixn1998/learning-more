import type { ServerDependencies } from '../app.js';
import type { LocalApplicationOptions } from './contracts.js';

export function createRuntimeReadiness(
  input: Readonly<{
    runtimeIdentity: LocalApplicationOptions['runtimeIdentity'];
    instanceId: string;
    getProviderStatus(): 'ready' | 'degraded';
    getProjectionStatus(): 'ready' | 'degraded';
  }>,
): ServerDependencies['getRuntimeReadiness'] {
  return async () => {
    const projectionStatus = input.getProjectionStatus();
    const providerStatus = input.getProviderStatus();
    return {
      // Derived projections can be rebuilt from their authoritative records. Their recovery
      // must remain observable, but it must not take the core runtime or unrelated writes down.
      status: providerStatus === 'ready' ? 'ready' : 'degraded',
      instanceId: input.instanceId,
      buildId: input.runtimeIdentity?.buildId ?? 'development',
      protocolVersion: input.runtimeIdentity?.protocolVersion ?? '1',
      storeStatus: 'ready',
      projectionStatus,
      providerStatus,
      ...(projectionStatus === 'degraded'
        ? { reasonCode: 'background_projection_recovery_failed' }
        : {}),
      ...(input.runtimeIdentity === undefined
        ? {}
        : {
            generation: input.runtimeIdentity.generation,
            startedAt: input.runtimeIdentity.startedAt,
            identityFingerprint: input.runtimeIdentity.identityFingerprint,
          }),
    };
  };
}
