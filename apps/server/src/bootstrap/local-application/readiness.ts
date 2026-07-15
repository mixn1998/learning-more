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
      status: projectionStatus === 'ready' && providerStatus === 'ready' ? 'ready' : 'degraded',
      instanceId: input.instanceId,
      buildId: input.runtimeIdentity?.buildId ?? 'development',
      protocolVersion: input.runtimeIdentity?.protocolVersion ?? '1',
      storeStatus: 'ready',
      projectionStatus,
      providerStatus,
      ...(projectionStatus === 'degraded'
        ? { reasonCode: 'teaching_observation_recovery_failed' }
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
