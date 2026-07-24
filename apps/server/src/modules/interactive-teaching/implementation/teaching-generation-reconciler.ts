import type { MaterializedTeachingMessage } from '../interface.js';
import type { TeachingAgent } from '../ports/teaching-agent.js';

type GenerationTask = Awaited<ReturnType<TeachingAgent['listTasks']>>[number];

function isRecoverableTask(task: GenerationTask): boolean {
  if (task.status === 'queued' || task.status === 'running') return true;
  return task.status === 'completed' && (task.draftMarkdown?.trim().length ?? 0) > 0;
}

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

function trailingEquivalentUnansweredUsers(
  messages: readonly MaterializedTeachingMessage[],
): readonly MaterializedTeachingMessage[] {
  const userIndex = messages.findLastIndex(
    (message) => message.role === 'user' && message.completionStatus === 'complete',
  );
  if (userIndex < 0) return [];
  const answered = messages
    .slice(userIndex + 1)
    .some((message) => message.role === 'assistant' && message.completionStatus === 'complete');
  if (answered) return [];

  const latest = messages[userIndex];
  if (latest === undefined) return [];
  const equivalentUsers = [latest];
  for (let index = userIndex - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (
      message === undefined ||
      message.role !== 'user' ||
      message.completionStatus !== 'complete' ||
      message.markdown !== latest.markdown
    ) {
      break;
    }
    equivalentUsers.push(message);
  }
  return equivalentUsers;
}

function sourceForTask(input: {
  task: GenerationTask;
  sessionId: string;
  activeTaskId?: string;
  messages: readonly MaterializedTeachingMessage[];
  unansweredUsers: readonly MaterializedTeachingMessage[];
}): string | undefined {
  const { task, sessionId, activeTaskId, messages, unansweredUsers } = input;
  if (task.requestRef === `opening:${sessionId}`) {
    return messages.some(
      (message) => message.role === 'assistant' && message.completionStatus === 'complete',
    )
      ? undefined
      : `opening:${sessionId}`;
  }
  if (task.requestRef !== undefined) {
    return unansweredUsers.some((message) => message.messageId === task.requestRef)
      ? task.requestRef
      : undefined;
  }
  if (unansweredUsers.length === 0) {
    return task.id === activeTaskId && messages.length === 0 ? `opening:${sessionId}` : undefined;
  }
  const promptMatchedUser = unansweredUsers.find(
    (message) => task.prompt?.includes(JSON.stringify(message.messageId)) === true,
  );
  if (promptMatchedUser !== undefined) return promptMatchedUser.messageId;
  return task.id === activeTaskId ? unansweredUsers[0]?.messageId : undefined;
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
  const unansweredUsers = trailingEquivalentUnansweredUsers(input.messages);
  const recoverable = input.tasks
    .filter((task) => isRecoverableTask(task) && !committedTaskIds.has(task.id))
    .map((task) => ({
      task,
      sourceMessageId: sourceForTask({
        task,
        sessionId: input.sessionId,
        ...(input.activeTaskId === undefined ? {} : { activeTaskId: input.activeTaskId }),
        messages: input.messages,
        unansweredUsers,
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
      !isRecoverableTask(active) ||
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
