import { describe, expect, it, vi } from 'vitest';

import { createMockProvider } from '../../../ai-providers/mock-provider.js';
import { createApiProvider } from '../../../ai-providers/api-provider.js';
import { createGenerationRuntime } from '../implementation/generation-runtime.js';
import { createInMemoryRepositories } from '../../../persistence/in-memory-repositories.js';
import { selectNextGenerationTask } from '../../../workers/generation-scheduler.js';
import type { GenerationTask } from '../ports/generation-task-repository.js';

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
});
