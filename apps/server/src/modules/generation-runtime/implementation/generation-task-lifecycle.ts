import type { GenerationTask } from '../ports/generation-task-repository.js';

export const DEFAULT_COMPLETED_TASK_DETAIL_RETENTION_MS = 24 * 60 * 60 * 1_000;
export const DEFAULT_FAILED_TASK_DETAIL_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;

export type GenerationTaskLifecyclePolicy = Readonly<{
  completedDetailRetentionMs: number;
  failedDetailRetentionMs: number;
}>;

export const DEFAULT_GENERATION_TASK_LIFECYCLE_POLICY: GenerationTaskLifecyclePolicy = {
  completedDetailRetentionMs: DEFAULT_COMPLETED_TASK_DETAIL_RETENTION_MS,
  failedDetailRetentionMs: DEFAULT_FAILED_TASK_DETAIL_RETENTION_MS,
};

function terminalRetentionMs(
  task: GenerationTask,
  policy: GenerationTaskLifecyclePolicy,
): number | undefined {
  if (task.status === 'completed') return policy.completedDetailRetentionMs;
  if (task.status === 'failed' || task.status === 'cancelled' || task.status === 'timeout') {
    return policy.failedDetailRetentionMs;
  }
  return undefined;
}

export function shouldCompactGenerationTask(
  task: GenerationTask,
  now: Date,
  policy: GenerationTaskLifecyclePolicy = DEFAULT_GENERATION_TASK_LIFECYCLE_POLICY,
): boolean {
  if (task.compactedAt !== undefined) return false;
  const retentionMs = terminalRetentionMs(task, policy);
  if (retentionMs === undefined) return false;
  const terminalAt = Date.parse(task.updatedAt);
  return Number.isFinite(terminalAt) && now.getTime() - terminalAt >= retentionMs;
}

export function compactGenerationTask(task: GenerationTask, compactedAt: Date): GenerationTask {
  const {
    prompt: _prompt,
    draftMarkdown: _draftMarkdown,
    resultRef: _ephemeralResultRef,
    fallbackProviderIds: _fallbackProviderIds,
    maxAttempts: _maxAttempts,
    leaseExpiresAt: _leaseExpiresAt,
    ...receipt
  } = task;
  void _prompt;
  void _draftMarkdown;
  void _ephemeralResultRef;
  void _fallbackProviderIds;
  void _maxAttempts;
  void _leaseExpiresAt;
  return {
    ...receipt,
    compactedAt: compactedAt.toISOString(),
    updatedAt: compactedAt.toISOString(),
  };
}
