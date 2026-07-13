import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type {
  ProviderCapabilities,
  ProviderHealth,
  ProviderPublicConfig,
  ProviderValidation,
  SecretResolver,
} from '../ai-providers/provider.js';
import { checksumJson, encodeJson } from '../persistence/json-codec.js';
import type { SecretStore } from './secret-store.js';

export type ProviderConfiguration = Readonly<{
  providerId: string;
  publicConfig: ProviderPublicConfig;
  secretHandles: Readonly<Record<string, string>>;
  configFingerprint: string;
  updatedAt: string;
}>;

export interface ProviderConfigRepository {
  get(): Promise<ProviderConfiguration | undefined>;
  replace(
    configuration: ProviderConfiguration | undefined,
    expectedFingerprint: string | undefined,
  ): Promise<void>;
}

export interface ProviderRuntimeControl {
  validateProvider(
    providerId: string,
    config: ProviderPublicConfig,
    secrets: SecretResolver,
  ): Promise<ProviderValidation>;
  checkProviderHealth(providerId: string): Promise<ProviderHealth>;
  describeProvider(providerId: string): ProviderCapabilities;
  switchProvider(providerId: string): Promise<void>;
}

export type ProviderSwitchInput = Readonly<{
  providerId: string;
  publicConfig: ProviderPublicConfig;
  secretHandles: Readonly<Record<string, string>>;
}>;

export type ProviderSwitchResult = Readonly<{
  providerId: string;
  capabilities: ProviderCapabilities;
  health: ProviderHealth;
}>;

function providerError(
  message: string,
  code: 'provider_validation_failed' | 'ai_unavailable' = 'provider_validation_failed',
): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

export function createMemoryProviderConfigRepository(): ProviderConfigRepository {
  let current: ProviderConfiguration | undefined;
  return {
    async get() {
      return current === undefined ? undefined : structuredClone(current);
    },
    async replace(configuration, expectedFingerprint) {
      if (current?.configFingerprint !== expectedFingerprint) {
        throw new Error('provider_config_conflict');
      }
      current = configuration === undefined ? undefined : structuredClone(configuration);
    },
  };
}

function parseConfiguration(value: unknown): ProviderConfiguration {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('provider_config_corrupted');
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 5 ||
    typeof record.providerId !== 'string' ||
    record.publicConfig === null ||
    typeof record.publicConfig !== 'object' ||
    Array.isArray(record.publicConfig) ||
    record.secretHandles === null ||
    typeof record.secretHandles !== 'object' ||
    Array.isArray(record.secretHandles) ||
    typeof record.configFingerprint !== 'string' ||
    !/^[a-f0-9]{64}$/.test(record.configFingerprint) ||
    typeof record.updatedAt !== 'string' ||
    !Number.isFinite(Date.parse(record.updatedAt))
  ) {
    throw new Error('provider_config_corrupted');
  }
  return record as ProviderConfiguration;
}

export function createLocalFileProviderConfigRepository(
  filePath: string,
): ProviderConfigRepository {
  const repository: ProviderConfigRepository = {
    async get() {
      try {
        return parseConfiguration(JSON.parse(await readFile(filePath, 'utf8')) as unknown);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
      }
    },
    async replace(configuration, expectedFingerprint) {
      const current = await repository.get();
      if (current?.configFingerprint !== expectedFingerprint) {
        throw new Error('provider_config_conflict');
      }
      if (configuration === undefined) {
        await rm(filePath, { force: true });
        return;
      }
      await mkdir(path.dirname(filePath), { recursive: true });
      const temporary = `${filePath}.${randomUUID()}.tmp`;
      const previous = `${filePath}.${randomUUID()}.previous`;
      let movedPrevious = false;
      try {
        await writeFile(temporary, encodeJson(configuration), { encoding: 'utf8', mode: 0o600 });
        try {
          await rename(filePath, previous);
          movedPrevious = true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        await rename(temporary, filePath);
        await rm(previous, { force: true });
      } catch (error) {
        if (movedPrevious) await rename(previous, filePath);
        throw error;
      } finally {
        await rm(temporary, { force: true });
        await rm(previous, { force: true });
      }
    },
  };
  return repository;
}

function assertSwitchInput(input: ProviderSwitchInput): void {
  if (input.providerId.trim() === '') throw new Error('provider_config_invalid');
  checksumJson(input.publicConfig);
  for (const [name, handle] of Object.entries(input.secretHandles)) {
    if (name.trim() === '' || handle.trim() === '') throw new Error('provider_config_invalid');
  }
}

export function createProviderConfigService(options: {
  runtime: ProviderRuntimeControl;
  secrets: SecretStore;
  repository: ProviderConfigRepository;
  now?: () => Date;
}): Readonly<{
  switchProvider(input: ProviderSwitchInput): Promise<ProviderSwitchResult>;
  getConfiguration(): Promise<ProviderConfiguration | undefined>;
}> {
  const now = options.now ?? (() => new Date());
  let barrier: Promise<void> = Promise.resolve();

  async function switchProvider(input: ProviderSwitchInput): Promise<ProviderSwitchResult> {
    assertSwitchInput(input);
    const secretFingerprints: Record<string, string> = {};
    for (const [name, handle] of Object.entries(input.secretHandles).sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      const description = await options.secrets.describe(handle);
      if (!description.configured) throw providerError('provider_secret_missing');
      secretFingerprints[name] = description.fingerprint ?? 'configured';
    }
    const resolveSecret: SecretResolver = async (name) => {
      const handle = input.secretHandles[name];
      if (handle === undefined) return undefined;
      return new TextDecoder('utf-8', { fatal: true }).decode(await options.secrets.get(handle));
    };
    const validation = await options.runtime.validateProvider(
      input.providerId,
      input.publicConfig,
      resolveSecret,
    );
    if (!validation.valid) throw providerError('provider_config_invalid');
    const health = await options.runtime.checkProviderHealth(input.providerId);
    if (health.status !== 'healthy') throw providerError('provider_unhealthy', 'ai_unavailable');
    const capabilities = options.runtime.describeProvider(input.providerId);
    const configFingerprint = createHash('sha256')
      .update(
        checksumJson({
          providerId: input.providerId,
          publicConfig: input.publicConfig,
          secretHandles: input.secretHandles,
          secretFingerprints,
        }),
      )
      .digest('hex');
    const previous = await options.repository.get();
    const next: ProviderConfiguration = {
      providerId: input.providerId,
      publicConfig: structuredClone(input.publicConfig),
      secretHandles: structuredClone(input.secretHandles),
      configFingerprint,
      updatedAt: now().toISOString(),
    };
    await options.repository.replace(next, previous?.configFingerprint);
    try {
      await options.runtime.switchProvider(input.providerId);
    } catch {
      try {
        await options.repository.replace(previous, next.configFingerprint);
      } catch {
        throw providerError('provider_switch_rollback_failed');
      }
      throw providerError('provider_switch_failed');
    }
    return { providerId: input.providerId, capabilities, health };
  }

  return {
    switchProvider(input) {
      const operation = barrier.then(
        () => switchProvider(input),
        () => switchProvider(input),
      );
      barrier = operation.then(
        () => undefined,
        () => undefined,
      );
      return operation;
    },
    getConfiguration: () => options.repository.get(),
  };
}
