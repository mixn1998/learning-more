export interface ProviderCapabilities {
  readonly id: string;
  readonly kind: 'mock' | 'api' | 'cli';
  readonly maxConcurrency: number;
  readonly supportsStreaming: true;
}

export type ProviderPublicConfig = Readonly<Record<string, unknown>>;
export type SecretResolver = (name: string) => Promise<string | undefined>;
export interface ProviderValidation {
  readonly valid: boolean;
  readonly message?: string;
}
export interface ProviderHealth {
  readonly status: 'healthy' | 'unhealthy';
  readonly message?: string;
}
export interface NormalizedGenerationRequest {
  readonly taskId: string;
  readonly prompt: string;
}
export interface ProviderDelta {
  readonly type: 'text';
  readonly text: string;
}

export interface AiProvider {
  describe(): ProviderCapabilities;
  validateConfig(
    config: ProviderPublicConfig,
    secrets: SecretResolver,
  ): Promise<ProviderValidation>;
  healthCheck(): Promise<ProviderHealth>;
  generate(request: NormalizedGenerationRequest, signal: AbortSignal): AsyncIterable<ProviderDelta>;
}
