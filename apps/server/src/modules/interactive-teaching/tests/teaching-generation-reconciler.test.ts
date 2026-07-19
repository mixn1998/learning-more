import { describe, expect, it } from 'vitest';

import type { GenerationTask } from '../../generation-runtime/ports/generation-task-repository.js';
import type { MaterializedTeachingMessage } from '../interface.js';
import { planTeachingGenerationReconciliation } from '../implementation/teaching-generation-reconciler.js';

function task(
  id: string,
  status: GenerationTask['status'],
  requestRef: string,
  updatedAt = '2026-07-19T12:00:00.000Z',
): GenerationTask {
  return {
    id,
    taskKey: `task-key:${id}`,
    status,
    createdAt: '2026-07-19T11:00:00.000Z',
    updatedAt,
    resourceVersion: 1,
    taskKind: 'interactive-teaching',
    taskGroup: 'interactive',
    ownerRef: 'session_1',
    requestRef,
  };
}

function user(messageId: string): MaterializedTeachingMessage {
  return {
    messageId,
    role: 'user',
    completionStatus: 'complete',
    markdown: 'Learner response',
    sourceRef: `message:${messageId}`,
  };
}

describe('teaching generation reconciliation planning', () => {
  it('recovers a completed reply for the latest unanswered source message', () => {
    expect(
      planTeachingGenerationReconciliation({
        sessionId: 'session_1',
        tasks: [task('task_completed', 'completed', 'message_user_1')],
        messages: [user('message_user_1')],
      }),
    ).toMatchObject({
      action: 'reply_recovered',
      taskId: 'task_completed',
      sourceMessageId: 'message_user_1',
      bindTask: true,
    });
  });

  it('rebinds a queued orphan and prefers a completed sibling when both exist', () => {
    const plan = planTeachingGenerationReconciliation({
      sessionId: 'session_1',
      tasks: [
        task('task_queued', 'queued', 'message_user_1', '2026-07-19T12:01:00.000Z'),
        task('task_completed', 'completed', 'message_user_1', '2026-07-19T12:00:00.000Z'),
      ],
      messages: [user('message_user_1')],
    });

    expect(plan).toMatchObject({
      action: 'reply_recovered',
      taskId: 'task_completed',
      bindTask: true,
      cancelTaskIds: ['task_queued'],
    });
  });

  it('never writes a completed reply after its source message was replaced', () => {
    const plan = planTeachingGenerationReconciliation({
      sessionId: 'session_1',
      tasks: [task('task_stale', 'completed', 'message_replaced')],
      messages: [user('message_current')],
    });

    expect(plan).toMatchObject({ action: 'ambiguous', bindTask: false });
    expect(plan.taskId).toBeUndefined();
  });

  it('clears a terminal active binding without selecting it for recovery', () => {
    expect(
      planTeachingGenerationReconciliation({
        sessionId: 'session_1',
        activeTaskId: 'task_failed',
        tasks: [task('task_failed', 'failed', 'message_user_1')],
        messages: [user('message_user_1')],
      }),
    ).toMatchObject({
      action: 'terminal_binding_cleared',
      clearActiveTask: true,
      bindTask: false,
    });
  });
});
