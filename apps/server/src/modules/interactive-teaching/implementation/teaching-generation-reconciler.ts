import type { GenerationTask } from '../../generation-runtime/ports/generation-task-repository.js';
import type { MaterializedTeachingMessage } from '../interface.js';

const RECOVERABLE_STATUSES = new Set<GenerationTask['status']>([
  'queued',
  'running',
  'completed',
]);

export type TeachingGenerationReconciliationPlan = Readonly<{
  action:
    | 'none'
    | 'resumed'
    | 'reply_recovered'
    | 'orphan_cancelled'
    | 'terminal_binding_cleared'
    | 'ambiguous';
  taskId?: string;
  sourceMessageId?: string;
  bindTask: boolean;
  clearActiveTask: boolean;
  cancelTaskIds: readonly string[];
}>;

function trailingUnansweredUser(
  messages: readonly MaterializedTeachingMessage[],
): MaterializedTeachingMessage | undefined {
  const userIndex = messages.findLastIndex(
    (message) => message.role === 'user' && message.completionStatus === 'complete',
  );
  if (userIndex < 0) return undefined;
  const answered = messages
    .slice(userIndex + 1)
    .some((message) => message.role === 'assistant' && message.completionStatus === 'complete');
  return answered ? undefined : messages[userIndex];
}

function sourceForTask(input: {
  task: GenerationTask;
  sessionId: string;
  activeTaskId?: string;
  messages: readonly MaterializedTeachingMessage[];
  unansweredUser?: MaterializedTeachingMessage;
}): string | undefined {
  const { task, sessionId, activeTaskId, messages, unansweredUser } = input;
  if (task.requestRef === `opening:${sessionId}`) {
    return messages.some(
      (message) => message.role === 'assistant' && message.completionStatus === 'complete',
    )
      ? undefined
      : `opening:${sessionId}`;
  }
  if (task.requestRef !== undefined) {
    return unansweredUser?.messageId === task.requestRef ? task.requestRef : undefined;
  }
  if (unansweredUser === undefined) {
    return task.id === activeTaskId && messages.length === 0 ? `opening:${sessionId}` : undefined;
  }
  if (task.id === activeTaskId) return unansweredUser.messageId;
  const encodedMessageId = JSON.stringify(unansweredUser.messageId);
  return task.prompt?.includes(encodedMessageId) === true ? unansweredUser.messageId : undefined;
}

function taskPriority(task: GenerationTask): number {
  if (task.status === 'completed') return 3;
  if (task.status === 'running') return 2;
  return 1;
}

export function planTeachingGenerationReconciliation(input: {
  sessionId: string;
  activeTaskId?: string;
  tasks: readonly GenerationTask[];
  messages: readonly MaterializedTeachingMessage[];
}): TeachingGenerationReconciliationPlan {
  const committedTaskIds = new Set(
    input.messages.flatMap((message) =>
      message.role === 'assistant' && message.generationTaskId !== undefined
        ? [message.generationTaskId]
        : [],
    ),
  );
  const unansweredUser = trailingUnansweredUser(input.messages);
  const recoverable = input.tasks
    .filter((task) => RECOVERABLE_STATUSES.has(task.status) && !committedTaskIds.has(task.id))
    .map((task) => ({
      task,
      sourceMessageId: sourceForTask({
        task,
        sessionId: input.sessionId,
        ...(input.activeTaskId === undefined ? {} : { activeTaskId: input.activeTaskId }),
        messages: input.messages,
        ...(unansweredUser === undefined ? {} : { unansweredUser }),
      }),
    }));
  const valid = recoverable
    .filter(
      (candidate): candidate is { task: GenerationTask; sourceMessageId: string } =>
        candidate.sourceMessageId !== undefined,
    )
    .sort(
      (left, right) =>
        taskPriority(right.task) - taskPriority(left.task) ||
        right.task.updatedAt.localeCompare(left.task.updatedAt) ||
        right.task.id.localeCompare(left.task.id),
    );
  const active =
    input.activeTaskId === undefined
      ? undefined
      : input.tasks.find((task) => task.id === input.activeTaskId);
  const activeCandidate = valid.find((candidate) => candidate.task.id === input.activeTaskId);
  const chosen = activeCandidate ?? valid[0];
  const clearActiveTask =
    input.activeTaskId !== undefined &&
    (active === undefined ||
      !RECOVERABLE_STATUSES.has(active.status) ||
      committedTaskIds.has(input.activeTaskId) ||
      activeCandidate === undefined);
  const cancelTaskIds = recoverable
    .filter(
      ({ task }) =>
        task.id !== chosen?.task.id && (task.status === 'queued' || task.status === 'running'),
    )
    .map(({ task }) => task.id)
    .sort();

  if (chosen === undefined) {
    const ambiguous = recoverable.length > 0;
    return {
      action: clearActiveTask
        ? 'terminal_binding_cleared'
        : cancelTaskIds.length > 0
            ? 'orphan_cancelled'
            : ambiguous
              ? 'ambiguous'
              : 'none',
      bindTask: false,
      clearActiveTask,
      cancelTaskIds,
    };
  }
  return {
    action: chosen.task.status === 'completed' ? 'reply_recovered' : 'resumed',
    taskId: chosen.task.id,
    sourceMessageId: chosen.sourceMessageId,
    bindTask: input.activeTaskId !== chosen.task.id,
    clearActiveTask,
    cancelTaskIds,
  };
}
