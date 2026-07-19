import { describe, expect, it, vi } from 'vitest';

import type { GenerationFrameLog, GenerationRuntime } from '../interface.js';
import { createGenerationExecution } from '../implementation/generation-execution.js';
import type { GenerationTask } from '../ports/generation-task-repository.js';

const queuedTask: GenerationTask = {
  id: 'task_plan_flow',
  taskKey: 'plan-flow-preview:flow_1:command_1',
  status: 'queued',
  createdAt: '2026-07-15T00:00:00.000Z',
  updatedAt: '2026-07-15T00:00:00.000Z',
  resourceVersion: 0,
  taskKind: 'plan-flow-preview',
  taskGroup: 'background',
  ownerRef: 'flow_1',
  inputSnapshotHash: 'snapshot_1',
  priority: 30,
  providerId: 'mock',
  prompt: 'plan this course',
  draftMarkdown: '',
};

describe('GenerationExecution', () => {
  it('waits for queued work when another generation already occupies the available slot', async () => {
    let reads = 0;
    const runtime: GenerationRuntime = {
      submit: vi.fn(),
      get: vi.fn(async () => ({
        ...queuedTask,
        status: ++reads >= 3 ? ('completed' as const) : ('queued' as const),
      })),
      runNext: vi.fn(async () => undefined),
      listByOwner: vi.fn(async () => []),
      recoverExpiredLeases: vi.fn(async () => 0),
      cancel: vi.fn(),
      getMetrics: vi.fn(),
    };
    const frameLog = {} as GenerationFrameLog;
    const execution = createGenerationExecution({ runtime, frameLog });

    await expect(execution.awaitTerminal(queuedTask.id)).resolves.toMatchObject({
      id: queuedTask.id,
      status: 'completed',
    });
    expect(runtime.runNext).toHaveBeenCalledOnce();
  });

  it('recovers an expired lease before declaring a queued plan-flow task undispatchable', async () => {
    let recovered = false;
    let completed = false;
    const runtime: GenerationRuntime = {
      submit: vi.fn(),
      get: vi.fn(async () => ({
        ...queuedTask,
        status: completed ? ('completed' as const) : ('queued' as const),
      })),
      runNext: vi.fn(async () => {
        if (!recovered) return undefined;
        completed = true;
        return queuedTask.id;
      }),
      recoverExpiredLeases: vi.fn(async () => {
        recovered = true;
        return 1;
      }),
      listByOwner: vi.fn(async () => []),
      cancel: vi.fn(),
      getMetrics: vi.fn(),
    };
    const frameLog = {} as GenerationFrameLog;
    const execution = createGenerationExecution({ runtime, frameLog });

    await expect(execution.awaitTerminal(queuedTask.id)).resolves.toMatchObject({
      id: queuedTask.id,
      status: 'completed',
    });
    expect(runtime.recoverExpiredLeases).toHaveBeenCalledOnce();
  });
});
