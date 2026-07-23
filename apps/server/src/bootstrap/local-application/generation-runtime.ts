import { randomUUID } from 'node:crypto';

import type { RuntimeRouteOptions } from '../../http/routes/runtime.js';
import { createGenerationFrameLog } from '../../modules/generation-runtime/implementation/frame-log.js';
import { createGenerationExecution } from '../../modules/generation-runtime/implementation/generation-execution.js';
import { createGenerationRuntime } from '../../modules/generation-runtime/implementation/generation-runtime.js';
import { createGenerationNextLessonRecommender } from '../../modules/next-lesson/implementation/generation-next-lesson-recommender.js';
import type { DataRoot } from '../../persistence/data-root.js';
import { createLocalFileRepositories } from '../../persistence/local-file-repositories.js';
import type { UnitOfWork } from '../../persistence/unit-of-work.js';
import { createMemorySecretStore } from '../../runtime/memory-secret-store.js';
import {
  createMemoryProviderConfigRepository,
  createProviderConfigService,
} from '../../runtime/provider-config-service.js';
import type { LocalApplicationOptions } from './contracts.js';
import { createLocalMockProvider } from './mock-provider-script.js';

export type LocalGenerationRuntime = Readonly<{
  runtime: ReturnType<typeof createGenerationRuntime>;
  execution: ReturnType<typeof createGenerationExecution>;
  frameLog: ReturnType<typeof createGenerationFrameLog>;
  nextLessonRecommender: ReturnType<typeof createGenerationNextLessonRecommender>;
  providerConfigService: ReturnType<typeof createProviderConfigService>;
  runtimeControl: RuntimeRouteOptions;
  getReadiness(): 'ready' | 'degraded';
}>;

export async function createLocalGenerationRuntime(
  input: Readonly<{
    dataRoot: DataRoot;
    unitOfWork: UnitOfWork;
    now: () => Date;
    applicationOptions: LocalApplicationOptions;
  }>,
): Promise<LocalGenerationRuntime> {
  const repositories = createLocalFileRepositories(input.dataRoot);
  const frameLog = createGenerationFrameLog(input.dataRoot);
  const provider = createLocalMockProvider({
    mockFailOnce: input.applicationOptions.mockFailOnce === true,
  });
  const providers = input.applicationOptions.providers ?? [
    provider,
    ...(input.applicationOptions.additionalProviders ?? []),
  ];
  const runtime = createGenerationRuntime({
    repository: repositories.generationTasks,
    unitOfWork: input.unitOfWork,
    providers,
    ...(input.applicationOptions.initialProviderId === undefined
      ? {}
      : { initialProviderId: input.applicationOptions.initialProviderId }),
    ...(input.applicationOptions.defaultFallbackProviderIds === undefined
      ? {}
      : { defaultFallbackProviderIds: input.applicationOptions.defaultFallbackProviderIds }),
    ...(input.applicationOptions.defaultMaxAttempts === undefined
      ? {}
      : { defaultMaxAttempts: input.applicationOptions.defaultMaxAttempts }),
    nextId: () => `task_${randomUUID()}`,
    now: input.now,
  });
  const execution = createGenerationExecution({ runtime, frameLog });
  const nextLessonRecommender = createGenerationNextLessonRecommender({
    execution,
    providerId: 'current',
  });
  const providerConfigService = createProviderConfigService({
    runtime,
    secrets: input.applicationOptions.secretStore ?? createMemorySecretStore(input.now),
    repository:
      input.applicationOptions.providerConfigRepository ?? createMemoryProviderConfigRepository(),
    now: input.now,
  });
  let readiness: 'ready' | 'degraded' = 'ready';
  const savedProviderConfiguration = await providerConfigService.getConfiguration();
  if (savedProviderConfiguration !== undefined) {
    try {
      await providerConfigService.switchProvider({
        providerId: savedProviderConfiguration.providerId,
        publicConfig: savedProviderConfiguration.publicConfig,
        secretHandles: savedProviderConfiguration.secretHandles,
      });
    } catch {
      readiness = 'degraded';
    }
  }

  return {
    runtime,
    execution,
    frameLog,
    nextLessonRecommender,
    providerConfigService,
    runtimeControl: {
      switchProvider: providerConfigService.switchProvider,
      getProviderStatus: providerConfigService.getStatus,
      reconnectProvider: providerConfigService.reconnect,
      getProviderCatalog: runtime.getProviderCatalog,
      startProviderAuthentication: async (providerId) => ({
        state: await runtime.startProviderAuthentication(providerId),
      }),
      ...(input.applicationOptions.createDiagnostics === undefined
        ? {}
        : { createDiagnostics: input.applicationOptions.createDiagnostics }),
      nextCorrelationId: () => `correlation_${randomUUID()}`,
    },
    getReadiness: () => readiness,
  };
}
