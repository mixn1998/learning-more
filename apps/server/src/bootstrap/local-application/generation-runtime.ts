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
  runLifecycleMaintenance(): Promise<number>;
  close(): Promise<void>;
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
  const secrets = input.applicationOptions.secretStore ?? createMemorySecretStore(input.now);
  const providerConfigService = createProviderConfigService({
    runtime,
    secrets,
    repository:
      input.applicationOptions.providerConfigRepository ?? createMemoryProviderConfigRepository(),
    now: input.now,
  });
  let readiness: 'ready' | 'degraded' = 'ready';
  const savedProviderConfiguration = await providerConfigService.getConfiguration();
  if (savedProviderConfiguration !== undefined) {
    try {
      const resolveSecret = async (name: string) => {
        const handle = savedProviderConfiguration.secretHandles[name];
        if (handle === undefined) return undefined;
        return new TextDecoder('utf-8', { fatal: true }).decode(await secrets.get(handle));
      };
      // The persisted selection was validated when it was saved. Restore it locally during
      // bootstrap and leave network/CLI health probing to the runtime status endpoint.
      await runtime.switchProvider(
        savedProviderConfiguration.providerId,
        savedProviderConfiguration.publicConfig,
        resolveSecret,
      );
    } catch {
      readiness = 'degraded';
    }
  }

  let lifecycleBarrier: Promise<number> | undefined;
  const runLifecycleMaintenance = async () => {
    if (lifecycleBarrier !== undefined) return lifecycleBarrier;
    lifecycleBarrier = (async () => {
      const compacted = await runtime.compactTerminalTasks();
      for (let offset = 0; offset < compacted.length; offset += 16) {
        await Promise.all(
          compacted
            .slice(offset, offset + 16)
            .map((task) =>
              frameLog.compactTerminal(
                task.id,
                task.status as 'completed' | 'failed' | 'cancelled' | 'timeout',
              ),
            ),
        );
      }
      return compacted.length;
    })();
    try {
      return await lifecycleBarrier;
    } finally {
      lifecycleBarrier = undefined;
    }
  };
  const lifecycleTimer = setInterval(
    () => void runLifecycleMaintenance().catch(() => undefined),
    6 * 60 * 60 * 1_000,
  );
  lifecycleTimer.unref();

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
    runLifecycleMaintenance,
    async close() {
      clearInterval(lifecycleTimer);
      await lifecycleBarrier?.catch(() => undefined);
    },
  };
}
