import { randomUUID } from 'node:crypto';

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

export interface GenerationRuntimeOptions {
  readonly repository: GenerationTaskRepository;
  readonly unitOfWork: UnitOfWork;
  readonly providers: readonly AiProvider[];
  readonly nextId?: () => string;
  readonly now?: () => Date;
}

export function createGenerationRuntime(options: GenerationRuntimeOptions): GenerationRuntime & {
  validateProvider(
    providerId: string,
    config: ProviderPublicConfig,
    secrets: SecretResolver,
  ): ReturnType<AiProvider['validateConfig']>;
  switchProvider(providerId: string): Promise<void>;
  getProviderStatus(): Promise<{ currentProviderId: string; providers: readonly string[] }>;
} {
  const providers = new Map(
    options.providers.map((provider) => [provider.describe().id, provider]),
  );
  const controllers = new Map<string, AbortController>();
  const nextId = options.nextId ?? (() => `task_${randomUUID()}`);
  const now = options.now ?? (() => new Date());
  let currentProviderId = options.providers[0]?.describe().id ?? '';

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
          providerId: request.providerId,
          prompt: request.prompt,
          draftMarkdown: '',
        },
        0,
      ),
    );
    return { taskId: id };
  }

  async function runNext(): Promise<string | undefined> {
    const tasks = await allTasks();
    const selected = selectNextGenerationTask(
      tasks.filter((task) => task.status === 'queued'),
      tasks.filter((task) => task.status === 'running'),
      providers,
      now(),
    );
    if (selected === undefined) return undefined;
    const provider = providers.get(selected.providerId ?? '');
    if (provider === undefined) {
      await persist({
        ...selected,
        status: 'failed',
        errorCode: 'provider_unavailable',
        updatedAt: now().toISOString(),
      });
      return selected.id;
    }
    let current = await persist({
      ...selected,
      status: 'running',
      updatedAt: now().toISOString(),
      leaseExpiresAt: new Date(now().getTime() + 30_000).toISOString(),
    });
    const controller = new AbortController();
    controllers.set(current.id, controller);
    try {
      for await (const delta of provider.generate(
        { taskId: current.id, prompt: current.prompt ?? '' },
        controller.signal,
      )) {
        if (controller.signal.aborted) break;
        current = await persist({
          ...current,
          draftMarkdown: `${current.draftMarkdown ?? ''}${delta.text}`,
          updatedAt: now().toISOString(),
          leaseExpiresAt: new Date(now().getTime() + 30_000).toISOString(),
        });
      }
      current = await get(current.id);
      if (current.status === 'running') {
        await persist({
          ...current,
          status: 'completed',
          resultRef: `generation-task:${current.id}:draft`,
          updatedAt: now().toISOString(),
        });
      }
    } catch (error) {
      current = await get(current.id);
      if (current.status === 'running') {
        await persist({
          ...current,
          status: controller.signal.aborted ? 'cancelled' : 'failed',
          errorCode: controller.signal.aborted ? 'generation_cancelled' : 'provider_failed',
          updatedAt: now().toISOString(),
        });
      }
      if (!controller.signal.aborted) void error;
    } finally {
      controllers.delete(current.id);
    }
    return current.id;
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
    validateProvider(providerId, config, secrets) {
      const provider = providers.get(providerId);
      if (provider === undefined) return Promise.resolve({ valid: false, message: 'not_found' });
      return provider.validateConfig(config, secrets);
    },
    async switchProvider(providerId) {
      if (!providers.has(providerId)) throw new Error('PROVIDER_NOT_FOUND');
      currentProviderId = providerId;
    },
    async getProviderStatus() {
      return { currentProviderId, providers: [...providers.keys()] };
    },
  };
}
