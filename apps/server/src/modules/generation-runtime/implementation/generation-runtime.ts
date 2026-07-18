import { randomUUID } from 'node:crypto';

import type { ProviderCatalog } from '@learning-more/contracts';

import type {
  AiProvider,
  ProviderPublicConfig,
  SecretResolver,
} from '../../../ai-providers/provider.js';
import type { UnitOfWork } from '../../../persistence/unit-of-work.js';
import { selectNextGenerationTask } from '../../../workers/generation-scheduler.js';
import type { GenerationRequest, GenerationRuntime, GenerationTaskHandle } from '../interface.js';
import type {
  GenerationTask,
  GenerationTaskRepository,
} from '../ports/generation-task-repository.js';
import { ProviderExecutionError } from '../../../ai-providers/provider.js';
import { reasoningEffortForScenario } from '../scenario-registry.js';

export interface GenerationRuntimeOptions {
  readonly repository: GenerationTaskRepository;
  readonly unitOfWork: UnitOfWork;
  readonly providers: readonly AiProvider[];
  readonly nextId?: () => string;
  readonly now?: () => Date;
  readonly taskTimeoutMs?: number;
  readonly initialProviderId?: string;
  readonly defaultFallbackProviderIds?: readonly string[];
  readonly defaultMaxAttempts?: number;
}

export function createGenerationRuntime(options: GenerationRuntimeOptions): GenerationRuntime & {
  drainQueued(maxDispatches?: number): Promise<number>;
  validateProvider(
    providerId: string,
    config: ProviderPublicConfig,
    secrets: SecretResolver,
  ): ReturnType<AiProvider['validateConfig']>;
  switchProvider(providerId: string): Promise<void>;
  describeProvider(providerId: string): ReturnType<AiProvider['describe']>;
  checkProviderHealth(providerId: string): ReturnType<AiProvider['healthCheck']>;
  getProviderStatus(): Promise<{ currentProviderId: string; providers: readonly string[] }>;
  getProviderCatalog(options?: Readonly<{ refresh?: boolean }>): Promise<ProviderCatalog>;
  startProviderAuthentication(providerId: string): Promise<'started' | 'already_authenticated'>;
} {
  const providers = new Map(
    options.providers.map((provider) => [provider.describe().id, provider]),
  );
  const controllers = new Map<string, AbortController>();
  const nextId = options.nextId ?? (() => `task_${randomUUID()}`);
  const now = options.now ?? (() => new Date());
  const taskTimeoutMs = options.taskTimeoutMs ?? 20 * 60 * 1_000;
  let currentProviderId = options.initialProviderId ?? options.providers[0]?.describe().id ?? '';
  let currentModel: string | undefined;
  let claimBarrier: Promise<void> = Promise.resolve();

  async function allTasks(): Promise<GenerationTask[]> {
    const tasks: GenerationTask[] = [];
    for await (const task of options.repository.list()) tasks.push(task);
    return tasks;
  }

  async function persist(task: GenerationTask): Promise<GenerationTask> {
    await options.unitOfWork.execute({ transactionId: `tx_generation_${randomUUID()}` }, (tx) =>
      options.repository.save(tx, task, task.resourceVersion),
    );
    const stored = await options.repository.get(task.id);
    if (stored === undefined) throw new Error('GENERATION_TASK_NOT_PERSISTED');
    return stored;
  }

  async function get(taskId: string): Promise<GenerationTask> {
    const task = await options.repository.get(taskId);
    if (task === undefined) throw new Error('GENERATION_TASK_NOT_FOUND');
    return task;
  }

  async function claimNext(): Promise<
    | Readonly<{
        kind: 'claimed';
        current: GenerationTask;
        providerIds: readonly string[];
        maxAttempts: number;
      }>
    | Readonly<{ kind: 'terminal'; taskId: string }>
    | undefined
  > {
    const previousClaim = claimBarrier;
    let releaseClaim!: () => void;
    claimBarrier = new Promise<void>((resolve) => {
      releaseClaim = resolve;
    });
    await previousClaim;
    try {
      const tasks = await allTasks();
      const selected = selectNextGenerationTask(
        tasks.filter((task) => task.status === 'queued'),
        tasks.filter((task) => task.status === 'running'),
        providers,
        now(),
      );
      if (selected === undefined) return undefined;
      const providerIds = [
        selected.providerId ?? '',
        ...(selected.fallbackProviderIds ?? []),
      ].filter((providerId, index, all) => providerId !== '' && all.indexOf(providerId) === index);
      const maxAttempts = Math.max(
        1,
        Math.min(selected.maxAttempts ?? providerIds.length, providerIds.length),
      );
      if (providerIds.length === 0) {
        const terminal = await persist({
          ...selected,
          status: 'failed',
          errorCode: 'provider_unavailable',
          updatedAt: now().toISOString(),
        });
        return { kind: 'terminal', taskId: terminal.id };
      }
      const current = await persist({
        ...selected,
        status: 'running',
        updatedAt: now().toISOString(),
        leaseExpiresAt: new Date(now().getTime() + 30_000).toISOString(),
      });
      return { kind: 'claimed', current, providerIds, maxAttempts };
    } finally {
      releaseClaim();
    }
  }

  async function submit(request: GenerationRequest): Promise<GenerationTaskHandle> {
    for (const task of await allTasks()) {
      if (
        task.taskKey === request.taskKey &&
        task.inputSnapshotHash === request.inputSnapshotHash &&
        task.status !== 'failed' &&
        task.status !== 'cancelled' &&
        task.status !== 'timeout'
      ) {
        return { taskId: task.id };
      }
    }
    const timestamp = now().toISOString();
    const id = nextId();
    const providerId = request.providerId === 'current' ? currentProviderId : request.providerId;
    const model = request.model ?? (request.providerId === 'current' ? currentModel : undefined);
    const reasoningEffort = request.reasoningEffort ?? reasoningEffortForScenario(request.taskKind);
    const fallbackProviderIds = request.fallbackProviderIds ?? options.defaultFallbackProviderIds;
    const maxAttempts = request.maxAttempts ?? options.defaultMaxAttempts;
    await options.unitOfWork.execute({ transactionId: `tx_generation_${randomUUID()}` }, (tx) =>
      options.repository.save(
        tx,
        {
          id,
          taskKey: request.taskKey,
          status: 'queued',
          createdAt: timestamp,
          updatedAt: timestamp,
          resourceVersion: 0,
          taskKind: request.taskKind,
          taskGroup: request.taskGroup,
          ownerRef: request.ownerRef,
          inputSnapshotHash: request.inputSnapshotHash,
          priority: request.priority,
          providerId,
          ...(model === undefined ? {} : { model }),
          ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
          ...(fallbackProviderIds === undefined
            ? {}
            : { fallbackProviderIds: [...fallbackProviderIds] }),
          ...(maxAttempts === undefined ? {} : { maxAttempts }),
          prompt: request.prompt,
          draftMarkdown: '',
        },
        0,
      ),
    );
    return { taskId: id };
  }

  async function runNext(): Promise<string | undefined> {
    const claim = await claimNext();
    if (claim === undefined) return undefined;
    if (claim.kind === 'terminal') return claim.taskId;
    const { providerIds, maxAttempts } = claim;
    let current = claim.current;
    for (let attemptIndex = 0; attemptIndex < maxAttempts; attemptIndex += 1) {
      const providerId = providerIds[attemptIndex]!;
      const provider = providers.get(providerId);
      const startedAt = now().toISOString();
      let emittedDelta = false;
      if (provider === undefined) {
        current = await persist({
          ...current,
          attempts: [
            ...(current.attempts ?? []),
            {
              providerId,
              ...(current.model === undefined ? {} : { model: current.model }),
              startedAt,
              completedAt: now().toISOString(),
              status: 'failed' as const,
              errorCode: 'provider_unavailable',
              emittedDelta: false,
            },
          ],
          updatedAt: now().toISOString(),
        });
        continue;
      }
      current = await persist({
        ...current,
        attempts: [
          ...(current.attempts ?? []),
          {
            providerId,
            ...(current.model === undefined ? {} : { model: current.model }),
            startedAt,
            status: 'running' as const,
            emittedDelta: false,
          },
        ],
        updatedAt: now().toISOString(),
      });
      const controller = new AbortController();
      controllers.set(current.id, controller);
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, taskTimeoutMs);
      try {
        for await (const delta of provider.generate(
          {
            taskId: current.id,
            prompt: current.prompt ?? '',
            ...(current.model === undefined ? {} : { model: current.model }),
            ...(current.reasoningEffort === undefined
              ? {}
              : { reasoningEffort: current.reasoningEffort }),
          },
          controller.signal,
        )) {
          if (controller.signal.aborted) break;
          emittedDelta = true;
          current = await persist({
            ...current,
            draftMarkdown: `${current.draftMarkdown ?? ''}${delta.text}`,
            attempts: (current.attempts ?? []).map((attempt, index, all) =>
              index === all.length - 1 ? { ...attempt, emittedDelta: true } : attempt,
            ),
            updatedAt: now().toISOString(),
            leaseExpiresAt: new Date(now().getTime() + 30_000).toISOString(),
          });
        }
        current = await get(current.id);
        if (current.status === 'running') {
          current = await persist({
            ...current,
            status: timedOut ? 'timeout' : 'completed',
            ...(timedOut ? {} : { resultRef: `generation-task:${current.id}:draft` }),
            ...(timedOut ? { errorCode: 'generation_timeout' } : {}),
            attempts: (current.attempts ?? []).map((attempt, index, all) =>
              index === all.length - 1
                ? {
                    ...attempt,
                    status: timedOut ? ('failed' as const) : ('completed' as const),
                    completedAt: now().toISOString(),
                    emittedDelta,
                  }
                : attempt,
            ),
            updatedAt: now().toISOString(),
          });
        }
        break;
      } catch (error) {
        current = await get(current.id);
        const providerError = error instanceof ProviderExecutionError ? error : undefined;
        const retryable =
          !emittedDelta &&
          !timedOut &&
          !controller.signal.aborted &&
          (providerError?.options.retryable ?? true);
        const errorCode = timedOut
          ? 'generation_timeout'
          : controller.signal.aborted
            ? 'generation_cancelled'
            : (providerError?.options.code ?? 'provider_failed');
        current = await persist({
          ...current,
          attempts: (current.attempts ?? []).map((attempt, index, all) =>
            index === all.length - 1
              ? {
                  ...attempt,
                  status: 'failed' as const,
                  completedAt: now().toISOString(),
                  errorCode,
                  emittedDelta,
                }
              : attempt,
          ),
          updatedAt: now().toISOString(),
        });
        if (retryable && attemptIndex + 1 < maxAttempts) continue;
        current = await persist({
          ...current,
          status: timedOut ? 'timeout' : controller.signal.aborted ? 'cancelled' : 'failed',
          errorCode,
          updatedAt: now().toISOString(),
        });
        break;
      } finally {
        clearTimeout(timeout);
        controllers.delete(current.id);
      }
    }
    return current.id;
  }

  async function drainQueued(maxDispatches = 1_000): Promise<number> {
    let dispatched = 0;
    while (dispatched < maxDispatches) {
      const taskId = await runNext();
      if (taskId === undefined) return dispatched;
      dispatched += 1;
    }
    return dispatched;
  }

  return {
    submit,
    runNext,
    get,
    async cancel(taskId) {
      controllers.get(taskId)?.abort();
      const task = await get(taskId);
      if (task.status !== 'running' && task.status !== 'queued') return task;
      return persist({
        ...task,
        status: 'cancelled',
        errorCode: 'generation_cancelled',
        updatedAt: now().toISOString(),
      });
    },
    async recoverExpiredLeases() {
      let recovered = 0;
      for (const task of await allTasks()) {
        if (
          task.status !== 'running' ||
          controllers.has(task.id) ||
          task.leaseExpiresAt === undefined ||
          new Date(task.leaseExpiresAt).getTime() >= now().getTime()
        ) {
          continue;
        }
        const hasOutput = (task.draftMarkdown?.length ?? 0) > 0;
        await persist({
          ...task,
          status: hasOutput && task.taskGroup === 'interactive' ? 'failed' : 'queued',
          ...(hasOutput && task.taskGroup === 'interactive'
            ? { errorCode: 'failed_recoverable' }
            : {}),
          updatedAt: now().toISOString(),
        });
        recovered += 1;
      }
      return recovered;
    },
    drainQueued,
    async getMetrics() {
      const byStatus: Record<string, number> = {};
      const byErrorCode: Record<string, number> = {};
      const tasks = await allTasks();
      for (const task of tasks) {
        byStatus[task.status] = (byStatus[task.status] ?? 0) + 1;
        if (task.errorCode !== undefined) {
          byErrorCode[task.errorCode] = (byErrorCode[task.errorCode] ?? 0) + 1;
        }
      }
      return { total: tasks.length, byStatus, byErrorCode };
    },
    validateProvider(providerId, config, secrets) {
      const provider = providers.get(providerId);
      if (provider === undefined) return Promise.resolve({ valid: false, message: 'not_found' });
      return provider.validateConfig(config, secrets);
    },
    async switchProvider(providerId, config?: ProviderPublicConfig, secrets?: SecretResolver) {
      if (!providers.has(providerId)) throw new Error('PROVIDER_NOT_FOUND');
      const provider = providers.get(providerId)!;
      if (config !== undefined && secrets !== undefined)
        await provider.configure?.(config, secrets);
      currentProviderId = providerId;
      currentModel =
        config !== undefined && typeof config.model === 'string' && config.model.trim() !== ''
          ? config.model.trim()
          : undefined;
    },
    describeProvider(providerId) {
      const provider = providers.get(providerId);
      if (provider === undefined) throw new Error('PROVIDER_NOT_FOUND');
      return provider.describe();
    },
    checkProviderHealth(providerId) {
      const provider = providers.get(providerId);
      if (provider === undefined) return Promise.resolve({ status: 'unhealthy' as const });
      return provider.healthCheck();
    },
    async getProviderStatus() {
      return { currentProviderId, providers: [...providers.keys()] };
    },
    async getProviderCatalog(input) {
      return {
        providers: await Promise.all(
          [...providers.entries()].map(async ([providerId, provider]) => {
            const capabilities = provider.describe();
            try {
              const health = await provider.healthCheck();
              const models =
                provider.listModels === undefined
                  ? []
                  : await provider.listModels({ refresh: input?.refresh ?? false });
              return {
                providerId,
                capabilities,
                health,
                models: models.map((model) => ({
                  ...model,
                  supportedReasoningEfforts: [...model.supportedReasoningEfforts],
                })),
              };
            } catch {
              return {
                providerId,
                capabilities,
                health: { status: 'unhealthy' as const, message: 'provider_catalog_unavailable' },
                models: [],
              };
            }
          }),
        ),
      };
    },
    async startProviderAuthentication(providerId) {
      const provider = providers.get(providerId);
      if (provider?.startAuthentication === undefined) {
        throw new Error('provider_authentication_unavailable');
      }
      return provider.startAuthentication();
    },
  };
}
