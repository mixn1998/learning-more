import { describe, expect, it } from 'vitest';

import type { GenerationRuntime } from '../../generation-runtime/interface.js';
import type { MaterializedTeachingMessage } from '../interface.js';
import { planTeachingGenerationReconciliation } from '../implementation/teaching-generation-reconciler.js';

type GenerationTask = Awaited<ReturnType<GenerationRuntime['get']>>;

function task(
  id: string,
  status: GenerationTask['status'],
  requestRef?: string,
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
    ...(status === 'completed' ? { draftMarkdown: 'Recovered teaching reply.' } : {}),
    ...(requestRef === undefined ? {} : { requestRef }),
  };
}

function user(messageId: string, markdown = 'Learner response'): MaterializedTeachingMessage {
  return {
    messageId,
    role: 'user',
    completionStatus: 'complete',
    markdown,
    sourceRef: `message:${messageId}`,
  };
}

function assistant(messageId: string, markdown = 'Teaching reply'): MaterializedTeachingMessage {
  return {
    messageId,
    role: 'assistant',
    completionStatus: 'complete',
    markdown,
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

  it('keeps an active system continuation bound to its latest assistant anchor', () => {
    expect(
      planTeachingGenerationReconciliation({
        sessionId: 'session_1',
        activeTaskId: 'task_continuation',
        tasks: [
          task(
            'task_continuation',
            'running',
            'continuation:session_1',
            '2026-07-19T12:01:00.000Z',
          ),
        ],
        messages: [user('message_user_1'), assistant('message_assistant_1')],
      }),
    ).toMatchObject({
      action: 'resumed',
      taskId: 'task_continuation',
      sourceMessageId: 'continuation:session_1',
      bindTask: false,
      clearActiveTask: false,
      cancelTaskIds: [],
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

  it('recovers a legacy task across consecutive identical retry messages', () => {
    const legacyTask = {
      ...task('task_legacy_retry', 'completed'),
      prompt: `allowed source ${JSON.stringify('message_user_original')}`,
    };

    expect(
      planTeachingGenerationReconciliation({
        sessionId: 'session_1',
        tasks: [legacyTask],
        messages: [
          user('message_user_original', 'The same learner answer'),
          user('message_user_duplicate', 'The same learner answer'),
        ],
      }),
    ).toMatchObject({
      action: 'reply_recovered',
      taskId: 'task_legacy_retry',
      sourceMessageId: 'message_user_original',
      bindTask: true,
    });
  });

  it('does not merge consecutive retry messages with different content', () => {
    const legacyTask = {
      ...task('task_stale_legacy', 'completed'),
      prompt: `allowed source ${JSON.stringify('message_user_original')}`,
    };

    const plan = planTeachingGenerationReconciliation({
      sessionId: 'session_1',
      tasks: [legacyTask],
      messages: [
        user('message_user_original', 'Original learner answer'),
        user('message_user_revised', 'Revised learner answer'),
      ],
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

  it('clears a legacy completed binding whose Provider produced no output', () => {
    expect(
      planTeachingGenerationReconciliation({
        sessionId: 'session_1',
        activeTaskId: 'task_empty',
        tasks: [{ ...task('task_empty', 'completed', 'message_user_1'), draftMarkdown: '' }],
        messages: [user('message_user_1')],
      }),
    ).toMatchObject({
      action: 'terminal_binding_cleared',
      clearActiveTask: true,
      bindTask: false,
    });
  });
});
