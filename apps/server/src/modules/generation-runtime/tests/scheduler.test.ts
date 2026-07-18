import { describe, expect, it, vi } from 'vitest';

import { createMockProvider } from '../../../ai-providers/mock-provider.js';
import { createApiProvider } from '../../../ai-providers/api-provider.js';
import { createGenerationRuntime } from '../implementation/generation-runtime.js';
import { createInMemoryRepositories } from '../../../persistence/in-memory-repositories.js';
import { selectNextGenerationTask } from '../../../workers/generation-scheduler.js';
import type { GenerationTask } from '../ports/generation-task-repository.js';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DataRoot } from '../../../persistence/data-root.js';
import { createLocalFileRepositories } from '../../../persistence/local-file-repositories.js';
import { createStorePaths, initializeStoreLayout } from '../../../persistence/paths.js';
import { createUnitOfWork } from '../../../persistence/unit-of-work.js';

const tx = {
  stageJson: async () => undefined,
  stageText: async () => undefined,
  deleteOnCommit: async () => undefined,
};

const unitOfWork = {
  async execute<T>(_request: unknown, work: (context: typeof tx) => Promise<T>) {
    return work(tx);
  },
};

describe('durable generation scheduler [EQ-GEN-01]', () => {
  it('publishes each Provider health and live model catalog through one runtime seam', async () => {
    const repositories = createInMemoryRepositories();
    const listModels = vi.fn(async () => [
      {
        id: 'gpt-5.6-sol',
        displayName: 'GPT-5.6-Sol',
        defaultReasoningEffort: 'low',
        supportedReasoningEfforts: ['low', 'ultra'],
      },
    ]);
    const startAuthentication = vi.fn(async () => 'started' as const);
    const provider = Object.assign(
      createMockProvider({ id: 'codex-cli', script: [{ type: 'text', text: 'answer' }] }),
      { listModels, startAuthentication },
    );
    const runtime = createGenerationRuntime({
      repository: repositories.generationTasks,
      unitOfWork,
      providers: [provider],
    });

    await expect(runtime.getProviderCatalog({ refresh: true })).resolves.toEqual({
      providers: [
        {
          providerId: 'codex-cli',
          capabilities: {
            id: 'codex-cli',
            kind: 'mock',
            maxConcurrency: 8,
            supportsStreaming: true,
          },
          health: { status: 'healthy' },
          models: [
            {
              id: 'gpt-5.6-sol',
              displayName: 'GPT-5.6-Sol',
              defaultReasoningEffort: 'low',
              supportedReasoningEfforts: ['low', 'ultra'],
            },
          ],
        },
      ],
    });
    expect(listModels).toHaveBeenCalledWith({ refresh: true });
    await expect(runtime.startProviderAuthentication('codex-cli')).resolves.toBe('started');
    expect(startAuthentication).toHaveBeenCalledOnce();
  });

  it('enforces real-provider, background, owner, and Mock concurrency ceilings', () => {
    const base: GenerationTask = {
      id: 'task_base',
      taskKey: 'base',
      status: 'queued',
      createdAt: '2026-07-13T00:00:00.000Z',
      updatedAt: '2026-07-13T00:00:00.000Z',
      resourceVersion: 1,
      taskGroup: 'interactive',
      ownerRef: 'owner-a',
      providerId: 'api',
      priority: 100,
    };
    const api = createApiProvider({ id: 'api', async *transport() {}, maxConcurrency: 5 });
    const mock = createMockProvider({ id: 'mock', script: [] });
    const providers = new Map([
      ['api', api],
      ['mock', mock],
    ]);
    const runningApi = [
      { ...base, id: 'running-1', status: 'running' as const, ownerRef: 'owner-x' },
      { ...base, id: 'running-2', status: 'running' as const, ownerRef: 'owner-y' },
    ];
    expect(selectNextGenerationTask([base], runningApi, providers, new Date())).toBeUndefined();

    const background = { ...base, id: 'background', taskGroup: 'background' as const };
    expect(
      selectNextGenerationTask(
        [background, { ...base, id: 'interactive', ownerRef: 'owner-b', priority: 90 }],
        [{ ...background, id: 'running-background', status: 'running' }],
        providers,
        new Date(),
      )?.id,
    ).toBe('interactive');

    expect(
      selectNextGenerationTask(
        [base, { ...base, id: 'other-owner', ownerRef: 'owner-b', priority: 90 }],
        [{ ...base, id: 'running-owner-a', status: 'running' }],
        providers,
        new Date(),
      )?.id,
    ).toBe('other-owner');

    const mockQueued = { ...base, id: 'mock-queued', providerId: 'mock' };
    const sevenMock = Array.from({ length: 7 }, (_, index) => ({
      ...mockQueued,
      id: `mock-running-${index}`,
      status: 'running' as const,
      ownerRef: `owner-${index}`,
    }));
    expect(selectNextGenerationTask([mockQueued], sevenMock, providers, new Date())?.id).toBe(
      'mock-queued',
    );
    expect(
      selectNextGenerationTask(
        [mockQueued],
        [...sevenMock, { ...mockQueued, id: 'mock-running-8', status: 'running' }],
        providers,
        new Date(),
      ),
    ).toBeUndefined();
  });

  it('joins identical task keys and input snapshots so the Provider runs once', async () => {
    const repositories = createInMemoryRepositories();
    const provider = createMockProvider({
      id: 'mock',
      script: [{ type: 'text', text: 'answer' }],
    });
    const generateSpy = vi.spyOn(provider, 'generate');
    const runtime = createGenerationRuntime({
      repository: repositories.generationTasks,
      unitOfWork,
      providers: [provider],
      nextId: () => 'task_01',
      now: () => new Date('2026-07-13T00:00:00.000Z'),
    });

    const first = await runtime.submit({
      taskKey: 'review:lesson_01',
      inputSnapshotHash: 'hash-a',
      taskKind: 'lesson-review',
      taskGroup: 'interactive',
      ownerRef: 'session_01',
      providerId: 'mock',
      priority: 80,
      prompt: 'review',
    });
    const joined = await runtime.submit({
      taskKey: 'review:lesson_01',
      inputSnapshotHash: 'hash-a',
      taskKind: 'lesson-review',
      taskGroup: 'interactive',
      ownerRef: 'session_01',
      providerId: 'mock',
      priority: 80,
      prompt: 'review',
    });

    expect(joined.taskId).toBe(first.taskId);
    await runtime.runNext();
    expect(generateSpy).toHaveBeenCalledTimes(1);
    await expect(runtime.get(first.taskId)).resolves.toMatchObject({
      status: 'completed',
      draftMarkdown: 'answer',
    });
  });

  it('persists and forwards scenario-specific reasoning effort', async () => {
    const repositories = createInMemoryRepositories();
    const provider = createMockProvider({
      id: 'mock',
      script: [{ type: 'text', text: 'answer' }],
    });
    const generateSpy = vi.spyOn(provider, 'generate');
    const runtime = createGenerationRuntime({
      repository: repositories.generationTasks,
      unitOfWork,
      providers: [provider],
      nextId: () => 'task_routed',
      now: () => new Date('2026-07-13T00:00:00.000Z'),
    });

    const handle = await runtime.submit({
      taskKey: 'teaching:turn:1',
      inputSnapshotHash: 'hash-turn-1',
      taskKind: 'interactive-teaching',
      taskGroup: 'interactive',
      ownerRef: 'session_01',
      providerId: 'mock',
      priority: 100,
      prompt: 'teach',
    });

    await expect(runtime.get(handle.taskId)).resolves.toMatchObject({
      reasoningEffort: 'medium',
    });
    await runtime.runNext();
    expect(generateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ reasoningEffort: 'medium' }),
      expect.any(AbortSignal),
    );
  });

  it('atomically claims different queued tasks when dispatchers run concurrently', async () => {
    const repositories = createInMemoryRepositories();
    const provider = createMockProvider({
      id: 'mock',
      scriptFactory: (_attempt, request) => [{ type: 'text', text: request.prompt }],
    });
    const ids = ['task_01', 'task_02'];
    const runtime = createGenerationRuntime({
      repository: repositories.generationTasks,
      unitOfWork,
      providers: [provider],
      nextId: () => ids.shift()!,
      now: () => new Date('2026-07-13T00:00:00.000Z'),
    });

    for (const [ownerRef, prompt] of [
      ['alignment-plan', 'plan'],
      ['conversation', 'reply'],
    ] as const) {
      await runtime.submit({
        taskKey: ownerRef,
        inputSnapshotHash: ownerRef,
        taskKind: ownerRef,
        taskGroup: 'interactive',
        ownerRef,
        providerId: 'mock',
        priority: 100,
        prompt,
      });
    }

    await expect(Promise.all([runtime.runNext(), runtime.runNext()])).resolves.toEqual([
      'task_01',
      'task_02',
    ]);
    await expect(runtime.get('task_01')).resolves.toMatchObject({
      status: 'completed',
      draftMarkdown: 'plan',
    });
    await expect(runtime.get('task_02')).resolves.toMatchObject({
      status: 'completed',
      draftMarkdown: 'reply',
    });
  });

  it('retains received deltas when cancellation aborts a running task', async () => {
    const repositories = createInMemoryRepositories();
    let release: (() => void) | undefined;
    const provider = createMockProvider({
      id: 'mock',
      script: [
        { type: 'text', text: 'partial' },
        { type: 'wait', wait: () => new Promise<void>((resolve) => (release = resolve)) },
        { type: 'text', text: 'late' },
      ],
    });
    const runtime = createGenerationRuntime({
      repository: repositories.generationTasks,
      unitOfWork,
      providers: [provider],
      nextId: () => 'task_cancel',
      now: () => new Date('2026-07-13T00:00:00.000Z'),
    });
    await runtime.submit({
      taskKey: 'chat:1',
      inputSnapshotHash: 'hash-b',
      taskKind: 'learning-chat',
      taskGroup: 'interactive',
      ownerRef: 'session_01',
      providerId: 'mock',
      priority: 100,
      prompt: 'chat',
    });

    const running = runtime.runNext();
    await vi.waitFor(async () => {
      await expect(runtime.get('task_cancel')).resolves.toMatchObject({ draftMarkdown: 'partial' });
    });
    await runtime.cancel('task_cancel');
    release?.();
    await running;

    await expect(runtime.get('task_cancel')).resolves.toMatchObject({
      status: 'cancelled',
      draftMarkdown: 'partial',
    });
  });

  it('snapshots current provider at submission so a runtime switch only affects new tasks', async () => {
    const repositories = createInMemoryRepositories();
    let releaseOld: (() => void) | undefined;
    const oldProvider = createMockProvider({
      id: 'old',
      script: [
        { type: 'wait', wait: () => new Promise<void>((resolve) => (releaseOld = resolve)) },
        { type: 'text', text: 'old-output' },
      ],
    });
    const newProvider = createMockProvider({
      id: 'new',
      script: [{ type: 'text', text: 'new-output' }],
    });
    let sequence = 0;
    const runtime = createGenerationRuntime({
      repository: repositories.generationTasks,
      unitOfWork,
      providers: [oldProvider, newProvider],
      nextId: () => `task_switch_${++sequence}`,
      now: () => new Date('2026-07-13T00:00:00.000Z'),
    });
    const first = await runtime.submit({
      taskKey: 'switch:old',
      inputSnapshotHash: 'hash-old',
      taskKind: 'learning-chat',
      taskGroup: 'interactive',
      ownerRef: 'owner-old',
      providerId: 'current',
      priority: 100,
      prompt: 'old',
    });
    const runningOld = runtime.runNext();
    await vi.waitFor(() => expect(releaseOld).toBeTypeOf('function'));
    await runtime.switchProvider('new');
    const second = await runtime.submit({
      taskKey: 'switch:new',
      inputSnapshotHash: 'hash-new',
      taskKind: 'learning-chat',
      taskGroup: 'interactive',
      ownerRef: 'owner-new',
      providerId: 'current',
      priority: 100,
      prompt: 'new',
    });
    releaseOld?.();
    await runningOld;
    await runtime.runNext();
    await expect(runtime.get(first.taskId)).resolves.toMatchObject({
      providerId: 'old',
      draftMarkdown: 'old-output',
    });
    await expect(runtime.get(second.taskId)).resolves.toMatchObject({
      providerId: 'new',
      draftMarkdown: 'new-output',
    });
  });

  it('falls back before the first delta and never switches after output starts', async () => {
    const repositories = createInMemoryRepositories();
    const primary = createMockProvider({
      script: [{ type: 'fail', error: new Error('offline') }],
      id: 'primary',
    });
    const backup = createMockProvider({ script: [{ type: 'text', text: 'backup' }], id: 'backup' });
    const runtime = createGenerationRuntime({
      repository: repositories.generationTasks,
      unitOfWork,
      providers: [primary, backup],
      nextId: () => 'task-fallback',
      now: () => new Date('2026-07-13T00:00:00.000Z'),
    });
    await runtime.submit({
      taskKey: 'fallback',
      inputSnapshotHash: 'fallback',
      taskKind: 'chat',
      taskGroup: 'interactive',
      ownerRef: 'owner',
      providerId: 'primary',
      fallbackProviderIds: ['backup'],
      maxAttempts: 2,
      priority: 100,
      prompt: 'hello',
      model: 'gpt-5.6-sol',
    });
    await runtime.runNext();
    await expect(runtime.get('task-fallback')).resolves.toMatchObject({
      status: 'completed',
      providerId: 'primary',
      model: 'gpt-5.6-sol',
      draftMarkdown: 'backup',
      attempts: [
        expect.objectContaining({ providerId: 'primary', status: 'failed', emittedDelta: false }),
        expect.objectContaining({ providerId: 'backup', status: 'completed', emittedDelta: true }),
      ],
    });

    const primaryWithOutput = createMockProvider({
      id: 'primary-output',
      script: [
        { type: 'text', text: 'partial' },
        { type: 'fail', error: new Error('after-output') },
      ],
    });
    const backupSpy = vi.spyOn(backup, 'generate');
    const secondRuntime = createGenerationRuntime({
      repository: createInMemoryRepositories().generationTasks,
      unitOfWork,
      providers: [primaryWithOutput, backup],
      nextId: () => 'task-no-fallback',
      now: () => new Date('2026-07-13T00:00:00.000Z'),
    });
    await secondRuntime.submit({
      taskKey: 'no-fallback',
      inputSnapshotHash: 'no-fallback',
      taskKind: 'chat',
      taskGroup: 'interactive',
      ownerRef: 'owner',
      providerId: 'primary-output',
      fallbackProviderIds: ['backup'],
      maxAttempts: 2,
      priority: 100,
      prompt: 'hello',
    });
    await secondRuntime.runNext();
    expect(backupSpy).not.toHaveBeenCalled();
    await expect(secondRuntime.get('task-no-fallback')).resolves.toMatchObject({
      status: 'failed',
      draftMarkdown: 'partial',
    });
  });

  it('requeues expired no-output leases and makes partial interactive output recoverable', async () => {
    const repositories = createInMemoryRepositories();
    const runtime = createGenerationRuntime({
      repository: repositories.generationTasks,
      unitOfWork,
      providers: [createMockProvider({ id: 'mock', script: [] })],
      nextId: () => 'unused',
      now: () => new Date('2026-07-13T00:01:00.000Z'),
    });
    await repositories.generationTasks.save(
      tx,
      {
        id: 'task_empty',
        taskKey: 'a',
        status: 'running',
        createdAt: '2026-07-13T00:00:00.000Z',
        updatedAt: '2026-07-13T00:00:00.000Z',
        resourceVersion: 0,
        taskGroup: 'background',
        leaseExpiresAt: '2026-07-13T00:00:30.000Z',
        draftMarkdown: '',
      },
      0,
    );
    await repositories.generationTasks.save(
      tx,
      {
        id: 'task_partial',
        taskKey: 'b',
        status: 'running',
        createdAt: '2026-07-13T00:00:00.000Z',
        updatedAt: '2026-07-13T00:00:00.000Z',
        resourceVersion: 0,
        taskGroup: 'interactive',
        leaseExpiresAt: '2026-07-13T00:00:30.000Z',
        draftMarkdown: 'partial',
      },
      0,
    );

    await runtime.recoverExpiredLeases();

    await expect(runtime.get('task_empty')).resolves.toMatchObject({ status: 'queued' });
    await expect(runtime.get('task_partial')).resolves.toMatchObject({
      status: 'failed',
      errorCode: 'failed_recoverable',
      draftMarkdown: 'partial',
    });
  });

  it('does not recover an expired lease while this runtime is still executing the task', async () => {
    const repositories = createInMemoryRepositories();
    let currentTime = new Date('2026-07-13T00:00:00.000Z');
    let releaseProvider: (() => void) | undefined;
    const runtime = createGenerationRuntime({
      repository: repositories.generationTasks,
      unitOfWork,
      providers: [
        createMockProvider({
          id: 'mock',
          script: [
            {
              type: 'wait',
              wait: () => new Promise<void>((resolve) => (releaseProvider = resolve)),
            },
            { type: 'text', text: 'answer after a slow first token' },
          ],
        }),
      ],
      nextId: () => 'task_slow_first_token',
      now: () => currentTime,
    });
    const submitted = await runtime.submit({
      taskKey: 'slow-first-token',
      inputSnapshotHash: 'slow-first-token',
      taskKind: 'plan-flow-preview',
      taskGroup: 'background',
      ownerRef: 'plan-flow-slow',
      providerId: 'mock',
      priority: 30,
      prompt: 'plan',
    });

    const running = runtime.runNext();
    await vi.waitFor(() => expect(releaseProvider).toBeTypeOf('function'));
    currentTime = new Date('2026-07-13T00:01:00.000Z');
    const recovered = await runtime.recoverExpiredLeases();
    const stateDuringExecution = await runtime.get(submitted.taskId);
    releaseProvider?.();
    await running;

    expect(recovered).toBe(0);
    expect(stateDuringExecution.status).toBe('running');
    await expect(runtime.get(submitted.taskId)).resolves.toMatchObject({
      status: 'completed',
      draftMarkdown: 'answer after a slow first token',
    });
  });

  it('replays an interrupted task after runtime recreation and drains the recovered queue', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'learning-more-generation-replay-'));
    try {
      const dataRoot = DataRoot.create(root);
      await initializeStoreLayout(createStorePaths(dataRoot));
      const repository = createLocalFileRepositories(dataRoot).generationTasks;
      const fileUnitOfWork = createUnitOfWork({ dataRoot });
      const replayProvider = () =>
        createApiProvider({
          id: 'replay-api',
          transport: async function* () {
            yield { type: 'text' as const, text: '# Replayed outline' };
          },
        });
      const firstRuntime = createGenerationRuntime({
        repository,
        unitOfWork: fileUnitOfWork,
        providers: [replayProvider()],
        nextId: () => 'task_replay',
        now: () => new Date('2026-07-13T00:00:00.000Z'),
      });
      await firstRuntime.submit({
        taskKey: 'outline-candidate:session_replay:command_01',
        inputSnapshotHash: 'replay-hash',
        taskKind: 'outline-candidate',
        taskGroup: 'interactive',
        ownerRef: 'session_replay',
        providerId: 'replay-api',
        priority: 100,
        prompt: 'outline',
      });
      const persisted = await firstRuntime.get('task_replay');
      await fileUnitOfWork.execute({ transactionId: 'tx_seed_interrupted_task' }, (context) =>
        repository.save(
          context,
          {
            ...persisted,
            status: 'running',
            leaseExpiresAt: '2026-07-13T00:00:30.000Z',
            attempts: [
              {
                providerId: 'replay-api',
                startedAt: '2026-07-13T00:00:00.000Z',
                status: 'running',
                emittedDelta: false,
              },
            ],
          },
          persisted.resourceVersion,
        ),
      );

      const restartedRuntime = createGenerationRuntime({
        repository,
        unitOfWork: fileUnitOfWork,
        providers: [replayProvider()],
        now: () => new Date('2026-07-13T00:01:00.000Z'),
      });
      await restartedRuntime.recoverExpiredLeases();
      await expect(restartedRuntime.get('task_replay')).resolves.toMatchObject({
        status: 'queued',
      });
      await expect(restartedRuntime.drainQueued()).resolves.toBe(1);
      await expect(restartedRuntime.get('task_replay')).resolves.toMatchObject({
        status: 'completed',
        draftMarkdown: '# Replayed outline',
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('[EQ-GEN-02] persists cancel and timeout terminal codes and exposes complete task metrics', async () => {
    const repositories = createInMemoryRepositories();
    let releaseTimeout: (() => void) | undefined;
    let sequence = 0;
    const runtime = createGenerationRuntime({
      repository: repositories.generationTasks,
      unitOfWork,
      providers: [
        createMockProvider({
          id: 'mock',
          script: [
            {
              type: 'wait',
              wait: () => new Promise<void>((resolve) => (releaseTimeout = resolve)),
            },
          ],
        }),
      ],
      nextId: () => `task_terminal_${++sequence}`,
      now: () => new Date(),
      taskTimeoutMs: 5,
    });
    const cancelled = await runtime.submit({
      taskKey: 'cancelled',
      inputSnapshotHash: 'cancelled-hash',
      taskKind: 'learning-chat',
      taskGroup: 'interactive',
      ownerRef: 'owner-cancelled',
      providerId: 'mock',
      priority: 100,
      prompt: 'cancel',
    });
    await runtime.cancel(cancelled.taskId);

    const timedOut = await runtime.submit({
      taskKey: 'timeout',
      inputSnapshotHash: 'timeout-hash',
      taskKind: 'learning-chat',
      taskGroup: 'interactive',
      ownerRef: 'owner-timeout',
      providerId: 'mock',
      priority: 100,
      prompt: 'timeout',
    });
    const running = runtime.runNext();
    await vi.waitFor(() => expect(releaseTimeout).toBeTypeOf('function'));
    await new Promise((resolve) => setTimeout(resolve, 10));
    releaseTimeout?.();
    await running;

    await expect(runtime.get(cancelled.taskId)).resolves.toMatchObject({
      status: 'cancelled',
      errorCode: 'generation_cancelled',
    });
    await expect(runtime.get(timedOut.taskId)).resolves.toMatchObject({
      status: 'timeout',
      errorCode: 'generation_timeout',
    });
    await expect(runtime.getMetrics()).resolves.toEqual({
      total: 2,
      byStatus: { cancelled: 1, timeout: 1 },
      byErrorCode: { generation_cancelled: 1, generation_timeout: 1 },
    });
  });
});
