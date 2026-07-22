import { describe, expect, it } from 'vitest';

import type { GenerationTask } from '../../generation-runtime/ports/generation-task-repository.js';
import { SupplementarySessionResponseSchema } from '@learning-more/contracts';
import { createInMemorySupplementarySessionRepository } from '../../../persistence/supplementary-session-repository.js';
import { createInMemoryMessageLog } from '../implementation/message-log.js';
import { createSupplementaryLearning } from '../implementation/supplementary-learning.js';
import { createSupplementarySessionModule } from '../implementation/supplementary-session-module.js';

const tx = {
  stageJson: async () => undefined,
  stageText: async () => undefined,
  deleteOnCommit: async () => undefined,
};
const unitOfWork = {
  async execute<T>(_request: unknown, work: (context: typeof tx) => Promise<T>) {
    return work(tx);
  },
};

function fixture(initialStatus: GenerationTask['status'] = 'completed') {
  const repository = createInMemorySupplementarySessionRepository();
  const messageLog = createInMemoryMessageLog();
  const sessions = createSupplementarySessionModule({
    repository,
    messageLog,
    unitOfWork,
    getCompletedLesson: async () => ({
      courseId: 'course_01',
      finalReview: { id: 'review_01' },
    }),
    nextSessionId: () => 'supplementary_01',
    now: () => new Date('2026-07-22T00:00:00.000Z'),
  });
  const artifacts = new Map<string, string>();
  let prompt = '';
  const task: GenerationTask = {
    id: 'task_01',
    taskKey: 'supplementary-learning:test',
    status: initialStatus,
    createdAt: '2026-07-22T00:00:00.000Z',
    updatedAt: '2026-07-22T00:00:01.000Z',
    resourceVersion: 1,
    draftMarkdown: initialStatus === 'completed' ? '这是补充学习回复。' : '',
  };
  const learning = createSupplementaryLearning({
    sessions,
    runtime: {
      get: async () => task,
    },
    execution: {
      async submit(request) {
        prompt = request.prompt;
        return { taskId: task.id };
      },
      async awaitTerminal() {
        return task;
      },
      async cancel() {
        Object.assign(task, { status: 'cancelled', updatedAt: '2026-07-22T00:00:02.000Z' });
        return task;
      },
    },
    artifacts: {
      async saveDraft(id, content) {
        artifacts.set(id, content);
      },
      async read(id) {
        const content = artifacts.get(id);
        return content === undefined
          ? undefined
          : {
              artifactId: id,
              kind: 'test',
              contentSha256: 'a'.repeat(64),
              immutable: false,
              content,
            };
      },
      async readDraft(id) {
        return artifacts.get(id);
      },
    },
    loadFinalReviewMarkdown: async () => '本课 Review 唯一上下文。',
    nextMessageId: (() => {
      let index = 0;
      return () => `message_${++index}`;
    })(),
    now: () => new Date('2026-07-22T00:00:03.000Z'),
    providerId: 'current',
  });
  return { learning, repository, artifacts, task, getPrompt: () => prompt };
}

describe('supplementary learning generation', () => {
  it('uses only the final Review plus the current supplementary history and persists both roles', async () => {
    const { learning, getPrompt } = fixture();
    const started = await learning.start('lesson_01');
    const accepted = await learning.send({
      sessionId: started.id,
      markdown: '请再解释一次。',
      expectedVersion: started.resourceVersion,
    });
    expect(accepted.taskId).toBe('task_01');
    expect(getPrompt()).toContain('本课 Review 唯一上下文。');
    expect(getPrompt()).toContain('请再解释一次。');
    expect(getPrompt()).not.toContain('原课堂秘密内容');

    await Promise.resolve();
    const view = await learning.view(started.id);
    expect(view.messages.map(({ role, markdown }) => ({ role, markdown }))).toEqual([
      { role: 'user', markdown: '请再解释一次。' },
      { role: 'assistant', markdown: '这是补充学习回复。' },
    ]);
    expect(view.activeGenerationTaskId).toBeUndefined();
  });

  it('cancels the active task when closing and freezes the archived conversation', async () => {
    const { learning, task } = fixture('running');
    const started = await learning.start('lesson_01');
    const accepted = await learning.send({
      sessionId: started.id,
      markdown: '继续讨论。',
      expectedVersion: started.resourceVersion,
    });
    const active = await learning.view(started.id);
    expect(active.activeGenerationTaskId).toBe(accepted.taskId);

    const archived = await learning.archive({
      sessionId: started.id,
      expectedVersion: active.resourceVersion,
    });
    expect(task.status).toBe('cancelled');
    expect(archived.status).toBe('archived');
    expect(archived.messages.map(({ role }) => role)).toEqual(['user']);
  });

  it('projects legacy message ids without leaking internal artifact references', async () => {
    const { learning, repository, artifacts } = fixture();
    artifacts.set('message_legacy', 'legacy supplementary question');
    await repository.save(
      tx,
      {
        id: 'supplementary_legacy',
        courseId: 'course_01',
        lessonId: 'lesson_01',
        sourceFinalReviewId: 'review_01',
        status: 'active',
        messageIds: ['message_legacy'],
        createdAt: '2026-07-21T00:00:00.000Z',
        updatedAt: '2026-07-21T00:01:00.000Z',
        resourceVersion: 0,
      },
      0,
    );

    const view = await learning.view('supplementary_legacy');

    expect(SupplementarySessionResponseSchema.safeParse(view).success).toBe(true);
    expect(view.messages).toEqual([
      {
        id: 'message_legacy',
        role: 'user',
        createdAt: '2026-07-21T00:01:00.000Z',
        completionStatus: 'complete',
        markdown: 'legacy supplementary question',
      },
    ]);
  });

  it('revises a legacy projected message that is not yet present in the shared message log', async () => {
    const { learning, repository, artifacts } = fixture('running');
    artifacts.set('message_legacy', 'legacy supplementary question');
    await repository.save(
      tx,
      {
        id: 'supplementary_legacy',
        courseId: 'course_01',
        lessonId: 'lesson_01',
        sourceFinalReviewId: 'review_01',
        status: 'active',
        messageIds: ['message_legacy'],
        createdAt: '2026-07-21T00:00:00.000Z',
        updatedAt: '2026-07-21T00:01:00.000Z',
        resourceVersion: 0,
      },
      0,
    );

    const before = await learning.view('supplementary_legacy');
    const accepted = await learning.revise({
      sessionId: 'supplementary_legacy',
      replacedUserMessageId: 'message_legacy',
      markdown: 'revised supplementary question',
      expectedVersion: before.resourceVersion,
    });
    const after = await learning.view('supplementary_legacy');

    expect(accepted.taskId).toBe('task_01');
    expect(after.messages.map(({ role, markdown }) => ({ role, markdown }))).toEqual([
      { role: 'user', markdown: 'revised supplementary question' },
    ]);
  });
});
