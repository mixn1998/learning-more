import { describe, expect, it } from 'vitest';

import { ProviderCatalogSchema, ProviderRuntimeStatusSchema } from './ai-runtime.js';

describe('AI runtime provider catalog contract', () => {
  it('accepts applied public configuration and rejects secret fields', () => {
    expect(
      ProviderRuntimeStatusSchema.parse({
        providerId: 'codex-cli',
        model: 'gpt-5.6-sol',
        reasoningEffort: 'high',
        configurationState: 'applied',
        capabilities: {
          id: 'codex-cli',
          kind: 'cli',
          maxConcurrency: 1,
          supportsStreaming: true,
        },
        health: { status: 'healthy' },
      }),
    ).toMatchObject({ reasoningEffort: 'high', configurationState: 'applied' });

    expect(() =>
      ProviderRuntimeStatusSchema.parse({
        providerId: 'codex-cli',
        configurationState: 'applied',
        capabilities: {
          id: 'codex-cli',
          kind: 'cli',
          maxConcurrency: 1,
          supportsStreaming: true,
        },
        health: { status: 'healthy' },
        secretHandles: { apiKey: 'private' },
      }),
    ).toThrow();
  });

  it('accepts a dynamic Codex CLI model catalog with supported reasoning efforts', () => {
    expect(
      ProviderCatalogSchema.parse({
        providers: [
          {
            providerId: 'codex-cli',
            capabilities: {
              id: 'codex-cli',
              kind: 'cli',
              maxConcurrency: 2,
              supportsStreaming: true,
            },
            health: { status: 'healthy' },
            models: [
              {
                id: 'gpt-5.6-sol',
                displayName: 'GPT-5.6-Sol',
                defaultReasoningEffort: 'low',
                supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
              },
            ],
          },
        ],
      }),
    ).toMatchObject({
      providers: [
        {
          providerId: 'codex-cli',
          models: [{ id: 'gpt-5.6-sol', defaultReasoningEffort: 'low' }],
        },
      ],
    });
  });

  it('rejects a catalog entry without a usable reasoning effort', () => {
    expect(() =>
      ProviderCatalogSchema.parse({
        providers: [
          {
            providerId: 'codex-cli',
            capabilities: {
              id: 'codex-cli',
              kind: 'cli',
              maxConcurrency: 2,
              supportsStreaming: true,
            },
            health: { status: 'unhealthy', message: 'codex_cli_catalog_unavailable' },
            models: [
              {
                id: 'gpt-5.6-sol',
                displayName: 'GPT-5.6-Sol',
                defaultReasoningEffort: 'low',
                supportedReasoningEfforts: [],
              },
            ],
          },
        ],
      }),
    ).toThrow();
  });
});
