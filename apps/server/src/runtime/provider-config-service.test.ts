import { describe, expect, it, vi } from 'vitest';

import { createMemorySecretStore } from './memory-secret-store.js';
import {
  createMemoryProviderConfigRepository,
  createProviderConfigService,
} from './provider-config-service.js';

describe('ProviderConfigService', () => {
  it('validates config, secret presence, and health before atomically switching', async () => {
    const secrets = createMemorySecretStore();
    await secrets.put('provider/api-key', new TextEncoder().encode('private-key'));
    const repository = createMemoryProviderConfigRepository();
    const switchProvider = vi.fn().mockResolvedValue(undefined);
    const runtime = {
      async validateProvider(
        providerId: string,
        config: Readonly<Record<string, unknown>>,
        resolveSecret: (name: string) => Promise<string | undefined>,
      ) {
        expect(providerId).toBe('api');
        expect(config).toEqual({ model: 'model-01' });
        expect(await resolveSecret('apiKey')).toBe('private-key');
        return { valid: true };
      },
      async checkProviderHealth() {
        return { status: 'healthy' as const };
      },
      describeProvider() {
        return {
          id: 'api',
          kind: 'api' as const,
          maxConcurrency: 2,
          supportsStreaming: true as const,
        };
      },
      switchProvider,
      async getProviderStatus() {
        return { currentProviderId: 'api', providers: ['api'] };
      },
    };
    const service = createProviderConfigService({ runtime, secrets, repository });
    const result = await service.switchProvider({
      providerId: 'api',
      publicConfig: { model: 'model-01' },
      secretHandles: { apiKey: 'provider/api-key' },
    });
    expect(result).toEqual({
      providerId: 'api',
      capabilities: runtime.describeProvider(),
      health: { status: 'healthy' },
    });
    expect(JSON.stringify(result)).not.toContain('private-key');
    expect(switchProvider).toHaveBeenCalledWith('api');
    await expect(repository.get()).resolves.toMatchObject({
      providerId: 'api',
      publicConfig: { model: 'model-01' },
      secretHandles: { apiKey: 'provider/api-key' },
      configFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    await expect(service.getStatus()).resolves.toEqual({
      providerId: 'api',
      model: 'model-01',
      health: { status: 'healthy' },
      capabilities: runtime.describeProvider(),
    });
  });

  it('[EQ-AI-01] reports Provider, model, health, and capabilities from the active runtime', async () => {
    const secrets = createMemorySecretStore();
    await secrets.put('provider/api-key', new TextEncoder().encode('private-key'));
    const repository = createMemoryProviderConfigRepository();
    let currentProviderId = 'mock';
    const runtime = {
      validateProvider: vi.fn().mockResolvedValue({ valid: true }),
      checkProviderHealth: vi.fn(async () => ({ status: 'healthy' as const })),
      describeProvider: vi.fn((providerId: string) => ({
        id: providerId,
        kind: providerId === 'mock' ? ('mock' as const) : ('api' as const),
        maxConcurrency: 2,
        supportsStreaming: true as const,
      })),
      async switchProvider(providerId: string) {
        currentProviderId = providerId;
      },
      async getProviderStatus() {
        return { currentProviderId, providers: ['mock', 'api'] };
      },
    };
    const service = createProviderConfigService({ runtime, secrets, repository });

    await service.switchProvider({
      providerId: 'api',
      publicConfig: { model: 'model-01', baseUrl: 'https://provider.invalid' },
      secretHandles: { apiKey: 'provider/api-key' },
    });

    await expect(service.getStatus()).resolves.toEqual({
      providerId: 'api',
      model: 'model-01',
      health: { status: 'healthy' },
      capabilities: {
        id: 'api',
        kind: 'api',
        maxConcurrency: 2,
        supportsStreaming: true,
      },
    });
    expect(runtime.checkProviderHealth).toHaveBeenLastCalledWith('api');
  });

  it('[EQ-AI-02] does not change active config when validation, secret, health, or switching fails', async () => {
    const secrets = createMemorySecretStore();
    const repository = createMemoryProviderConfigRepository();
    const runtime = {
      validateProvider: vi.fn().mockResolvedValue({ valid: false }),
      checkProviderHealth: vi.fn().mockResolvedValue({ status: 'healthy' as const }),
      describeProvider: vi.fn(() => ({
        id: 'api',
        kind: 'api' as const,
        maxConcurrency: 2,
        supportsStreaming: true as const,
      })),
      switchProvider: vi.fn().mockResolvedValue(undefined),
      getProviderStatus: vi
        .fn()
        .mockResolvedValue({ currentProviderId: 'api', providers: ['api'] }),
    };
    const service = createProviderConfigService({ runtime, secrets, repository });
    await expect(
      service.switchProvider({
        providerId: 'api',
        publicConfig: {},
        secretHandles: { apiKey: 'missing' },
      }),
    ).rejects.toThrow('provider_secret_missing');
    expect(runtime.validateProvider).not.toHaveBeenCalled();
    await secrets.put('missing', new TextEncoder().encode('configured'));
    await expect(
      service.switchProvider({
        providerId: 'api',
        publicConfig: {},
        secretHandles: { apiKey: 'missing' },
      }),
    ).rejects.toThrow('provider_config_invalid');
    expect(runtime.switchProvider).not.toHaveBeenCalled();
    await expect(repository.get()).resolves.toBeUndefined();
    runtime.validateProvider.mockResolvedValue({ valid: true });
    runtime.checkProviderHealth.mockResolvedValue({ status: 'unhealthy' });
    await expect(
      service.switchProvider({
        providerId: 'api',
        publicConfig: {},
        secretHandles: { apiKey: 'missing' },
      }),
    ).rejects.toThrow('provider_unhealthy');
    expect(runtime.switchProvider).not.toHaveBeenCalled();
    runtime.checkProviderHealth.mockResolvedValue({ status: 'healthy' });
    runtime.switchProvider.mockRejectedValueOnce(new Error('adapter failed'));
    await expect(
      service.switchProvider({
        providerId: 'api',
        publicConfig: {},
        secretHandles: { apiKey: 'missing' },
      }),
    ).rejects.toThrow('provider_switch_failed');
    await expect(repository.get()).resolves.toBeUndefined();
  });
});
