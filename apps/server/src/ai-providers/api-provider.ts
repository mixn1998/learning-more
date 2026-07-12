import type { AiProvider, NormalizedGenerationRequest, ProviderDelta } from './provider.js';

export type ApiProviderTransport = (
  request: NormalizedGenerationRequest,
  signal: AbortSignal,
) => AsyncIterable<ProviderDelta>;

export function createApiProvider(options: {
  readonly id: string;
  readonly transport: ApiProviderTransport;
  readonly maxConcurrency?: number;
}): AiProvider {
  return {
    describe: () => ({
      id: options.id,
      kind: 'api',
      maxConcurrency: options.maxConcurrency ?? 2,
      supportsStreaming: true,
    }),
    validateConfig: async () => ({ valid: true }),
    healthCheck: async () => ({ status: 'healthy' }),
    generate: (request, signal) => options.transport(request, signal),
  };
}
