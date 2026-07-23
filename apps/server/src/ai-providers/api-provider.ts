import {
  ProviderExecutionError,
  type AiProvider,
  type NormalizedGenerationRequest,
  type ProviderDelta,
} from './provider.js';

export type ApiProviderTransport = (
  request: NormalizedGenerationRequest,
  signal: AbortSignal,
) => AsyncIterable<ProviderDelta>;

function configString(config: Record<string, unknown>, key: string): string | undefined {
  const value = config[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function resolveUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/$/, '');
  return normalized.endsWith('/chat/completions') ? normalized : `${normalized}/chat/completions`;
}

async function* fetchChatCompletions(
  request: NormalizedGenerationRequest,
  signal: AbortSignal,
): AsyncIterable<ProviderDelta> {
  const baseUrl = request.baseUrl;
  const model = request.model;
  if (baseUrl === undefined || model === undefined) {
    throw new ProviderExecutionError('api_config_missing', {
      retryable: false,
      beforeFirstDelta: true,
      code: 'provider_config_invalid',
    });
  }
  let response: Response;
  try {
    response = await fetch(resolveUrl(baseUrl), {
      method: 'POST',
      headers: {
        accept: 'text/event-stream',
        'content-type': 'application/json',
        ...(request.apiKey === undefined ? {} : { authorization: `Bearer ${request.apiKey}` }),
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: request.prompt }],
        stream: true,
      }),
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new ProviderExecutionError('api_transport_failed', {
      retryable: true,
      beforeFirstDelta: true,
      code: 'provider_transport_failed',
    });
  }
  if (!response.ok) {
    const retryable = response.status === 429 || response.status >= 500;
    throw new ProviderExecutionError(`api_http_${response.status}`, {
      retryable,
      beforeFirstDelta: true,
      code: retryable ? 'provider_retryable' : 'provider_http_failed',
    });
  }
  if (response.body === null) {
    throw new ProviderExecutionError('api_stream_missing', {
      retryable: true,
      beforeFirstDelta: true,
      code: 'provider_protocol_failed',
    });
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() ?? '';
      for (const event of events) {
        for (const line of event.split(/\r?\n/)) {
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') return;
          let parsed: unknown;
          try {
            parsed = JSON.parse(data);
          } catch {
            throw new ProviderExecutionError('api_sse_invalid_json', {
              retryable: false,
              beforeFirstDelta: true,
              code: 'provider_protocol_failed',
            });
          }
          const text =
            typeof parsed === 'object' &&
            parsed !== null &&
            'choices' in parsed &&
            Array.isArray(parsed.choices) &&
            parsed.choices[0] !== null &&
            typeof parsed.choices[0] === 'object' &&
            'delta' in parsed.choices[0] &&
            parsed.choices[0].delta !== null &&
            typeof parsed.choices[0].delta === 'object' &&
            'content' in parsed.choices[0].delta &&
            typeof parsed.choices[0].delta.content === 'string'
              ? parsed.choices[0].delta.content
              : '';
          if (text !== '') yield { type: 'text', text };
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export function createApiProvider(options: {
  readonly id: string;
  readonly transport?: ApiProviderTransport;
  readonly maxConcurrency?: number;
  readonly defaultConfig?: Readonly<{ baseUrl: string; model: string; apiKey?: string }>;
}): AiProvider {
  let activeConfig = options.defaultConfig;
  return {
    describe: () => ({
      id: options.id,
      kind: 'api',
      maxConcurrency: options.maxConcurrency ?? 2,
      supportsStreaming: true,
    }),
    validateConfig: async (config, secrets) => {
      if (options.transport !== undefined) return { valid: true };
      const record = config as Record<string, unknown>;
      const baseUrl = configString(record, 'baseUrl');
      const model = configString(record, 'model');
      if (baseUrl === undefined || model === undefined) return { valid: false, message: 'config' };
      try {
        new URL(resolveUrl(baseUrl));
      } catch {
        return { valid: false, message: 'baseUrl' };
      }
      const secretHandle = configString(record, 'apiKeySecretHandle');
      if (secretHandle !== undefined && (await secrets(secretHandle)) === undefined) {
        return { valid: false, message: 'apiKey' };
      }
      return { valid: true };
    },
    async healthCheck() {
      if (options.transport !== undefined) return { status: 'healthy' as const };
      if (activeConfig === undefined)
        return { status: 'healthy' as const, message: 'unconfigured' };
      try {
        const response = await fetch(`${activeConfig.baseUrl.replace(/\/$/, '')}/models`, {
          method: 'GET',
          headers: {
            accept: 'application/json',
            ...(activeConfig.apiKey === undefined
              ? {}
              : { authorization: `Bearer ${activeConfig.apiKey}` }),
          },
        });
        return response.ok
          ? { status: 'healthy' as const }
          : { status: 'unhealthy' as const, message: `http_${response.status}` };
      } catch {
        return { status: 'unhealthy' as const, message: 'transport' };
      }
    },
    async configure(config, secrets) {
      const record = config as Record<string, unknown>;
      const baseUrl = configString(record, 'baseUrl');
      const model = configString(record, 'model');
      if (baseUrl === undefined || model === undefined) throw new Error('provider_config_invalid');
      const apiKey = await secrets('apiKey');
      activeConfig = { baseUrl, model, ...(apiKey === undefined ? {} : { apiKey }) };
    },
    generate: (request, signal) =>
      options.transport === undefined
        ? fetchChatCompletions(
            {
              ...request,
              ...(request.baseUrl === undefined && activeConfig !== undefined
                ? { baseUrl: activeConfig.baseUrl }
                : {}),
              ...(request.model === undefined && activeConfig !== undefined
                ? { model: activeConfig.model }
                : {}),
              ...(request.apiKey === undefined && activeConfig?.apiKey !== undefined
                ? { apiKey: activeConfig.apiKey }
                : {}),
            },
            signal,
          )
        : options.transport(request, signal),
  };
}
