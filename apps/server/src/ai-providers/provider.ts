import type { ProviderModelOption } from '@learning-more/contracts';

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
  readonly model?: string;
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly executable?: string;
  readonly arguments?: readonly string[];
  readonly workingDirectory?: string;
  readonly environment?: Readonly<Record<string, string>>;
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
  listModels?(options?: Readonly<{ refresh?: boolean }>): Promise<readonly ProviderModelOption[]>;
  startAuthentication?(): Promise<'started' | 'already_authenticated'>;
  configure?(config: ProviderPublicConfig, secrets: SecretResolver): Promise<void>;
  generate(request: NormalizedGenerationRequest, signal: AbortSignal): AsyncIterable<ProviderDelta>;
}

export class ProviderExecutionError extends Error {
  constructor(
    message: string,
    readonly options: Readonly<{
      retryable: boolean;
      beforeFirstDelta?: boolean;
      code?: string;
    }>,
  ) {
    super(message);
    this.name = 'ProviderExecutionError';
  }
}
