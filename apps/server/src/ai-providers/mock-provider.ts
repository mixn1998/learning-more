import type { AiProvider, NormalizedGenerationRequest, ProviderDelta } from './provider.js';

export type MockProviderStep =
  | ProviderDelta
  | Readonly<{ type: 'wait'; wait: () => Promise<void> }>
  | Readonly<{ type: 'fail'; error: Error }>;

export function createMockProvider(options: {
  readonly id: string;
  readonly script?: readonly MockProviderStep[];
  readonly scriptFactory?: (
    attempt: number,
    request: NormalizedGenerationRequest,
  ) => readonly MockProviderStep[];
}): AiProvider {
  let attempt = 0;
  return {
    describe: () => ({
      id: options.id,
      kind: 'mock',
      maxConcurrency: 8,
      supportsStreaming: true,
    }),
    validateConfig: async () => ({ valid: true }),
    healthCheck: async () => ({ status: 'healthy' }),
    async *generate(request: NormalizedGenerationRequest, signal: AbortSignal) {
      attempt += 1;
      const script = options.scriptFactory?.(attempt, request) ?? options.script ?? [];
      for (const step of script) {
        if (signal.aborted) return;
        if (step.type === 'wait') await step.wait();
        else if (step.type === 'fail') throw step.error;
        else yield step;
        if (signal.aborted) return;
      }
    },
  };
}
