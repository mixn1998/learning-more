import type { GenerationExecution, GenerationFrameLog, GenerationRuntime } from '../interface.js';
import type { GenerationTask } from '../ports/generation-task-repository.js';

const TERMINAL = new Set<GenerationTask['status']>(['completed', 'failed', 'cancelled', 'timeout']);
const RECOVERY_RECHECK_INTERVAL_MS = 250;
const MAX_TERMINAL_WAIT_MS = 20 * 60 * 1_000;

function waitForScheduler(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, RECOVERY_RECHECK_INTERVAL_MS));
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
    let latest = await options.runtime.get(taskId);
    let wake: (() => void) | undefined;
    const unsubscribe = options.runtime.subscribe?.(taskId, (task) => {
      latest = task;
      wake?.();
      wake = undefined;
    });
    const waitForUpdate = () =>
      new Promise<void>((resolve) => {
        wake = resolve;
      });
    try {
      while (dispatches < maxDispatches) {
        if (TERMINAL.has(latest.status)) return latest;
        const ran = await options.runtime.runNext();
        if (ran !== undefined) {
          dispatches += 1;
          latest = await options.runtime.get(taskId);
          continue;
        }
        const recovered = await options.runtime.recoverExpiredLeases();
        if (recovered > 0) {
          latest = await options.runtime.get(taskId);
          continue;
        }
        if (TERMINAL.has(latest.status)) return latest;
        if (Date.now() >= waitDeadline) break;
        await Promise.race([waitForUpdate(), waitForScheduler()]);
        if (wake !== undefined) wake = undefined;
        latest = await options.runtime.get(taskId);
      }
    } finally {
      unsubscribe?.();
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
    subscribe: (taskId, observer) => options.runtime.subscribe?.(taskId, observer) ?? (() => {}),
    cancel: (taskId) => options.runtime.cancel(taskId),
    async invalidate(taskId, errorCode) {
      if (options.runtime.invalidate === undefined) {
        throw new Error('generation_invalidation_unavailable');
      }
      return options.runtime.invalidate(taskId, errorCode);
    },
    async recover(taskId) {
      await options.runtime.recoverExpiredLeases();
      return awaitTerminal(taskId);
    },
  };
}
