import type { GenerationExecution, GenerationFrameLog, GenerationRuntime } from '../interface.js';
import type { GenerationTask } from '../ports/generation-task-repository.js';

const TERMINAL = new Set<GenerationTask['status']>(['completed', 'failed', 'cancelled', 'timeout']);

export function createGenerationExecution(options: {
  runtime: GenerationRuntime;
  frameLog: GenerationFrameLog;
  maxDispatches?: number;
}): GenerationExecution {
  const maxDispatches = options.maxDispatches ?? 1_000;
  async function awaitTerminal(taskId: string): Promise<GenerationTask> {
    for (let dispatch = 0; dispatch < maxDispatches; dispatch += 1) {
      const task = await options.runtime.get(taskId);
      if (TERMINAL.has(task.status)) return task;
      const ran = await options.runtime.runNext();
      if (ran === undefined) {
        throw Object.assign(new Error('generation_task_not_dispatchable'), {
          code: 'generation_task_not_dispatchable',
          taskId,
        });
      }
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
