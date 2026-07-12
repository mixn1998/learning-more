import { RuntimeReadySchema, type RuntimeReady } from '@learning-more/contracts';

export async function fetchRuntimeReadiness(signal: AbortSignal): Promise<RuntimeReady> {
  const response = await fetch('/api/v1/runtime/ready', {
    headers: { accept: 'application/json' },
    signal,
  });
  if (!response.ok) {
    throw new Error('Runtime readiness request failed');
  }
  return RuntimeReadySchema.parse(await response.json());
}
