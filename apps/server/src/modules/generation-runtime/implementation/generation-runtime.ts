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
import {
  compactGenerationTask,
  DEFAULT_GENERATION_TASK_LIFECYCLE_POLICY,
  shouldCompactGenerationTask,
  type GenerationTaskLifecyclePolicy,
} from './generation-task-lifecycle.js';

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
  readonly maxInteractiveContinuationAttempts?: number;
}

class GenerationPersistenceError extends Error {
  readonly code = 'generation_storage_failed';

  constructor(cause: unknown) {
    super('generation_storage_failed', { cause });
    this.name = 'GenerationPersistenceError';
  }
}

export function createGenerationRuntime(options: GenerationRuntimeOptions): GenerationRuntime & {
  drainQueued(maxDispatches?: number): Promise<number>;
  validateProvider(
    providerId: string,
    config: ProviderPublicConfig,
    secrets: SecretResolver,
  ): ReturnType<AiProvider['validateConfig']>;
  switchProvider(
    providerId: string,
    config?: ProviderPublicConfig,
    secrets?: SecretResolver,
  ): Promise<void>;
  describeProvider(providerId: string): ReturnType<AiProvider['describe']>;
  checkProviderHealth(providerId: string): ReturnType<AiProvider['healthCheck']>;
  getProviderStatus(): Promise<{ currentProviderId: string; providers: readonly string[] }>;
  getProviderCatalog(options?: Readonly<{ refresh?: boolean }>): Promise<ProviderCatalog>;
  startProviderAuthentication(providerId: string): Promise<'started' | 'already_authenticated'>;
  compactTerminalTasks(policy?: GenerationTaskLifecyclePolicy): Promise<readonly GenerationTask[]>;
} {
  const providers = new Map(
    options.providers.map((provider) => [provider.describe().id, provider]),
  );
  const controllers = new Map<string, AbortController>();
  const cancellationRequested = new Set<string>();
  const taskMutationBarriers = new Map<string, Promise<void>>();
  const nextId = options.nextId ?? (() => `task_${randomUUID()}`);
  const now = options.now ?? (() => new Date());
  const taskTimeoutMs = options.taskTimeoutMs ?? 20 * 60 * 1_000;
  const maxInteractiveContinuationAttempts = Math.max(
    0,
    options.maxInteractiveContinuationAttempts ?? 2,
  );
  let currentProviderId = options.initialProviderId ?? options.providers[0]?.describe().id ?? '';
  let currentModel: string | undefined;
  let schedulerBarrier: Promise<void> = Promise.resolve();
  const subscribers = new Map<string, Set<(task: GenerationTask) => void>>();
  let taskIndex: Map<string, GenerationTask> | undefined;
  let taskIndexLoading: Promise<Map<string, GenerationTask>> | undefined;

  function publish(task: GenerationTask): void {
    for (const observer of subscribers.get(task.id) ?? []) {
      try {
        observer(task);
      } catch {
        // A UI subscriber must never interrupt generation or persistence.
      }
    }
  }

  async function indexedTasks(): Promise<Map<string, GenerationTask>> {
    if (taskIndex !== undefined) return taskIndex;
    taskIndexLoading ??= (async () => {
      const loaded = new Map<string, GenerationTask>();
      for await (const task of options.repository.list()) loaded.set(task.id, task);
      taskIndex = loaded;
      return loaded;
    })();
    try {
      return await taskIndexLoading;
    } finally {
      taskIndexLoading = undefined;
    }
  }

  async function allTasks(): Promise<GenerationTask[]> {
    return [...(await indexedTasks()).values()];
  }

  async function persist(task: GenerationTask): Promise<GenerationTask> {
    try {
      await options.unitOfWork.execute({ transactionId: `tx_generation_${randomUUID()}` }, (tx) =>
        options.repository.save(tx, task, task.resourceVersion),
      );
      const stored = await options.repository.get(task.id);
      if (stored === undefined) throw new Error('GENERATION_TASK_NOT_PERSISTED');
      (await indexedTasks()).set(stored.id, stored);
      publish(stored);
      return stored;
    } catch (error) {
      if (error instanceof GenerationPersistenceError) throw error;
      throw new GenerationPersistenceError(error);
    }
  }

  async function project(task: GenerationTask): Promise<GenerationTask> {
    (await indexedTasks()).set(task.id, task);
    publish(task);
    return task;
  }

  async function mutatePersistedTask(
    taskId: string,
    transition: (task: GenerationTask) => GenerationTask | undefined,
  ): Promise<GenerationTask> {
    const previous = taskMutationBarriers.get(taskId) ?? Promise.resolve();
    let release!: () => void;
    const currentBarrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queuedBarrier = previous.then(() => currentBarrier);
    taskMutationBarriers.set(taskId, queuedBarrier);
    await previous;
    try {
      const durable = await options.repository.get(taskId);
      if (durable === undefined) throw new Error('GENERATION_TASK_NOT_FOUND');
      const projected = (await indexedTasks()).get(taskId);
      const source =
        projected === undefined
          ? durable
          : {
              ...projected,
              resourceVersion: durable.resourceVersion,
            };
      const next = transition(source);
      return next === undefined ? project(source) : persist(next);
    } finally {
      release();
      if (taskMutationBarriers.get(taskId) === queuedBarrier) {
        taskMutationBarriers.delete(taskId);
      }
    }
  }

  async function get(taskId: string): Promise<GenerationTask> {
    const projected = (await indexedTasks()).get(taskId);
    if (projected !== undefined) return projected;
    const task = await options.repository.get(taskId);
    if (task === undefined) throw new Error('GENERATION_TASK_NOT_FOUND');
    return task;
  }

  async function withSchedulerBarrier<T>(work: () => Promise<T>): Promise<T> {
    const previousOperation = schedulerBarrier;
    let releaseOperation!: () => void;
    schedulerBarrier = new Promise<void>((resolve) => {
      releaseOperation = resolve;
    });
    await previousOperation;
    try {
      return await work();
    } finally {
      releaseOperation();
    }
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
    return withSchedulerBarrier(async () => {
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
    });
  }

  async function submit(request: GenerationRequest): Promise<GenerationTaskHandle> {
    for (const task of await allTasks()) {
      const reusableCompletedResult =
        task.status !== 'completed' || (task.draftMarkdown?.trim().length ?? 0) > 0;
      if (
        task.taskKey === request.taskKey &&
        task.inputSnapshotHash === request.inputSnapshotHash &&
        reusableCompletedResult &&
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
          ...(request.requestRef === undefined ? {} : { requestRef: request.requestRef }),
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
    const stored = await options.repository.get(id);
    if (stored === undefined) throw new Error('GENERATION_TASK_NOT_PERSISTED');
    (await indexedTasks()).set(stored.id, stored);
    return { taskId: id };
  }

  async function runNext(): Promise<string | undefined> {
    const claim = await claimNext();
    if (claim === undefined) return undefined;
    if (claim.kind === 'terminal') return claim.taskId;
    const { providerIds, maxAttempts } = claim;
    let current = claim.current;
    let providerIndex = 0;
    let continuationAttempts = 0;
    let continuationFrom: string | undefined;
    while (providerIndex < maxAttempts) {
      const providerId = providerIds[providerIndex]!;
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
        providerIndex += 1;
        if (providerIndex >= maxAttempts) {
          current = await persist({
            ...current,
            status: 'failed',
            errorCode: 'provider_unavailable',
            updatedAt: now().toISOString(),
          });
        }
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
            prompt:
              continuationFrom === undefined
                ? (current.prompt ?? '')
                : `${current.prompt ?? ''}\n\n[Interrupted response continuation]\nThe response below was already shown to the learner before a recoverable transport interruption. Continue from the exact interrupted point without repeating or restarting it. Finish the same response and its required hidden machine state.\n\n${continuationFrom}`,
            ...(current.model === undefined ? {} : { model: current.model }),
            ...(current.reasoningEffort === undefined
              ? {}
              : { reasoningEffort: current.reasoningEffort }),
          },
          controller.signal,
        )) {
          if (controller.signal.aborted) break;
          emittedDelta = true;
          const deltaAt = now().toISOString();
          current = await project({
            ...current,
            draftMarkdown: `${current.draftMarkdown ?? ''}${delta.text}`,
            ...(current.firstDeltaAt === undefined ? { firstDeltaAt: deltaAt } : {}),
            attempts: (current.attempts ?? []).map((attempt, index, all) =>
              index === all.length - 1 ? { ...attempt, emittedDelta: true } : attempt,
            ),
            updatedAt: deltaAt,
            leaseExpiresAt: new Date(now().getTime() + 30_000).toISOString(),
          });
        }
        if (!timedOut && !controller.signal.aborted && !emittedDelta) {
          throw new ProviderExecutionError('Provider exited without producing output', {
            retryable: true,
            beforeFirstDelta: true,
            code: 'provider_empty_output',
          });
        }
        current = await mutatePersistedTask(current.id, (latest) => {
          if (latest.status !== 'running' || (!timedOut && cancellationRequested.has(latest.id))) {
            return undefined;
          }
          return {
            ...latest,
            status: timedOut ? 'timeout' : 'completed',
            ...(timedOut ? {} : { resultRef: `generation-task:${latest.id}:draft` }),
            ...(timedOut ? { errorCode: 'generation_timeout' } : {}),
            attempts: (latest.attempts ?? []).map((attempt, index, all) =>
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
          };
        });
        break;
      } catch (error) {
        current = await get(current.id);
        const providerError = error instanceof ProviderExecutionError ? error : undefined;
        const persistenceError = error instanceof GenerationPersistenceError;
        const retryable =
          !persistenceError &&
          !timedOut &&
          !controller.signal.aborted &&
          (providerError?.options.retryable ?? true);
        const errorCode = timedOut
          ? 'generation_timeout'
          : controller.signal.aborted
            ? 'generation_cancelled'
            : persistenceError
              ? 'generation_storage_failed'
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
        const canContinueInteractiveReply =
          retryable &&
          current.taskKind === 'interactive-teaching' &&
          (emittedDelta || continuationFrom !== undefined) &&
          (current.draftMarkdown ?? '').length > 0 &&
          continuationAttempts < maxInteractiveContinuationAttempts;
        if (canContinueInteractiveReply) {
          continuationAttempts += 1;
          continuationFrom = current.draftMarkdown ?? '';
          continue;
        }
        if (
          retryable &&
          !emittedDelta &&
          continuationFrom === undefined &&
          providerIndex + 1 < maxAttempts
        ) {
          providerIndex += 1;
          continue;
        }
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
        cancellationRequested.delete(current.id);
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
    subscribe(taskId, observer) {
      const taskSubscribers = subscribers.get(taskId) ?? new Set<(task: GenerationTask) => void>();
      taskSubscribers.add(observer);
      subscribers.set(taskId, taskSubscribers);
      return () => {
        taskSubscribers.delete(observer);
        if (taskSubscribers.size === 0) subscribers.delete(taskId);
      };
    },
    async listByOwner(ownerRef, taskKind) {
      return (await allTasks()).filter(
        (task) =>
          task.ownerRef === ownerRef && (taskKind === undefined || task.taskKind === taskKind),
      );
    },
    async cancel(taskId) {
      cancellationRequested.add(taskId);
      controllers.get(taskId)?.abort();
      return mutatePersistedTask(taskId, (task) => {
        if (task.status !== 'running' && task.status !== 'queued') return undefined;
        return {
          ...task,
          status: 'cancelled',
          errorCode: 'generation_cancelled',
          updatedAt: now().toISOString(),
        };
      });
    },
    async invalidate(taskId, errorCode) {
      controllers.get(taskId)?.abort();
      const task = await get(taskId);
      if (task.status === 'failed' && task.errorCode === errorCode) return task;
      const { resultRef: _resultRef, ...withoutResult } = task;
      void _resultRef;
      return persist({
        ...withoutResult,
        status: 'failed',
        errorCode,
        attempts: (task.attempts ?? []).map((attempt, index, all) =>
          index === all.length - 1 && attempt.status === 'completed'
            ? { ...attempt, status: 'failed' as const, errorCode }
            : attempt,
        ),
        updatedAt: now().toISOString(),
      });
    },
    async recoverExpiredLeases() {
      return withSchedulerBarrier(async () => {
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
          const recoveredAt = now().toISOString();
          const attempts = task.attempts?.map((attempt, index, all) =>
            index === all.length - 1 && attempt.status === 'running'
              ? {
                  ...attempt,
                  status: 'failed' as const,
                  completedAt: recoveredAt,
                  errorCode: 'generation_interrupted',
                }
              : attempt,
          );
          const {
            leaseExpiresAt: _expiredLease,
            errorCode: _previousErrorCode,
            ...recoverableTask
          } = task;
          void _expiredLease;
          void _previousErrorCode;
          await persist({
            ...recoverableTask,
            status: hasOutput && task.taskGroup === 'interactive' ? 'failed' : 'queued',
            ...(hasOutput && task.taskGroup === 'interactive'
              ? { errorCode: 'failed_recoverable' }
              : {}),
            ...(attempts === undefined ? {} : { attempts }),
            updatedAt: recoveredAt,
          });
          recovered += 1;
        }
        return recovered;
      });
    },
    async compactTerminalTasks(policy = DEFAULT_GENERATION_TASK_LIFECYCLE_POLICY) {
      return withSchedulerBarrier(async () => {
        const lifecycleNow = now();
        const candidates = (await allTasks()).filter((task) =>
          shouldCompactGenerationTask(task, lifecycleNow, policy),
        );
        const compacted: GenerationTask[] = [];
        for (let offset = 0; offset < candidates.length; offset += 100) {
          const batch = candidates
            .slice(offset, offset + 100)
            .map((task) => compactGenerationTask(task, lifecycleNow));
          await options.unitOfWork.execute(
            { transactionId: `tx_generation_lifecycle_${randomUUID()}` },
            async (tx) => {
              for (const task of batch) {
                await options.repository.save(tx, task, task.resourceVersion);
              }
            },
          );
          for (const task of batch) {
            const stored = await options.repository.get(task.id);
            if (stored === undefined) throw new Error('GENERATION_TASK_NOT_PERSISTED');
            (await indexedTasks()).set(stored.id, stored);
            publish(stored);
            compacted.push(stored);
          }
        }
        return compacted;
      });
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
              const models =
                provider.listModels === undefined
                  ? []
                  : await provider.listModels({ refresh: input?.refresh ?? false });
              // A forced catalog refresh may discover that CLI authentication
              // has expired. Read health after that refresh so the response
              // cannot combine stale healthy state with an unauthenticated catalog.
              const health = await provider.healthCheck();
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
