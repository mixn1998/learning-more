import type { GenerationExecution, GenerationFrameLog, GenerationRuntime } from '../interface.js';
import type { GenerationTask } from '../ports/generation-task-repository.js';

const TERMINAL = new Set<GenerationTask['status']>(['completed', 'failed', 'cancelled', 'timeout']);
const IDLE_POLL_INTERVAL_MS = 25;
const MAX_TERMINAL_WAIT_MS = 20 * 60 * 1_000;

function waitForScheduler(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, IDLE_POLL_INTERVAL_MS));
}

export function createGenerationExecution(options: {
  runtime: GenerationRuntime;
  frameLog: GenerationFrameLog;
  maxDispatches?: number;
}): GenerationExecution {
  const maxDispatches = options.maxDispatches ?? 1_000;
  async function awaitTerminal(taskId: string): Promise<GenerationTask> {
    const waitDeadline = Date.now() + MAX_TERMINAL_WAIT_MS;
    let dispatches = 0;
    while (dispatches < maxDispatches) {
      const task = await options.runtime.get(taskId);
      if (TERMINAL.has(task.status)) return task;
      const ran = await options.runtime.runNext();
      if (ran !== undefined) {
        dispatches += 1;
        continue;
      }
      const recovered = await options.runtime.recoverExpiredLeases();
      if (recovered > 0) continue;
      const current = await options.runtime.get(taskId);
      if (TERMINAL.has(current.status)) return current;
      if (Date.now() >= waitDeadline) break;
      await waitForScheduler();
    }
    throw Object.assign(new Error('generation_terminal_wait_exhausted'), {
      code: 'generation_terminal_wait_exhausted',
      taskId,
    });
  }

  return {
    submit: (request) => options.runtime.submit(request),
    awaitTerminal,
    stream: (taskId, afterSequence) => options.frameLog.readAfter(taskId, afterSequence),
    cancel: (taskId) => options.runtime.cancel(taskId),
    async recover(taskId) {
      await options.runtime.recoverExpiredLeases();
      return awaitTerminal(taskId);
    },
  };
}
