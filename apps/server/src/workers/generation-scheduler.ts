import type { AiProvider } from '../ai-providers/provider.js';
import type { GenerationTask } from '../modules/generation-runtime/ports/generation-task-repository.js';

export function selectNextGenerationTask(
  queued: readonly GenerationTask[],
  running: readonly GenerationTask[],
  providers: ReadonlyMap<string, AiProvider>,
  now: Date,
): GenerationTask | undefined {
  const candidates = [...queued].sort((left, right) => {
    const leftAge = Math.min(
      95,
      Math.floor((now.getTime() - new Date(left.createdAt).getTime()) / 60_000),
    );
    const rightAge = Math.min(
      95,
      Math.floor((now.getTime() - new Date(right.createdAt).getTime()) / 60_000),
    );
    return (right.priority ?? 0) + rightAge - ((left.priority ?? 0) + leftAge);
  });
  for (const task of candidates) {
    const provider = providers.get(task.providerId ?? '');
    if (provider === undefined) continue;
    const capabilities = provider.describe();
    const systemLimit = capabilities.kind === 'mock' ? 8 : 2;
    const providerRunning = running.filter((item) => item.providerId === task.providerId);
    if (providerRunning.length >= Math.min(systemLimit, capabilities.maxConcurrency)) continue;
    if (
      task.taskGroup === 'background' &&
      running.some((item) => item.taskGroup === 'background')
    ) {
      continue;
    }
    if (
      task.taskGroup === 'interactive' &&
      running.some((item) => item.taskGroup === 'interactive' && item.ownerRef === task.ownerRef)
    ) {
      continue;
    }
    return task;
  }
  return undefined;
}
