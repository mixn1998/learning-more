import { createHash } from 'node:crypto';

import type { GenerationExecution, GenerationRuntime } from '../../generation-runtime/interface.js';
import type { createMarkdownArtifactStore } from '../../../persistence/markdown-artifact-store.js';
import type { LearningMessage } from './message-log.js';
import type { createSupplementarySessionModule } from './supplementary-session-module.js';

type SupplementarySessions = ReturnType<typeof createSupplementarySessionModule>;
type Runtime = Pick<GenerationRuntime, 'get'>;
type Execution = Pick<GenerationExecution, 'submit' | 'awaitTerminal' | 'cancel'>;

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function renderPrompt(
  reviewMarkdown: string,
  messages: readonly Readonly<{ role: 'user' | 'assistant'; markdown: string }>[],
): string {
  const history = messages
    .map((message) => `${message.role === 'user' ? '学习者' : '补充学习助手'}：${message.markdown}`)
    .join('\n\n');
  return [
    'SUPPLEMENTARY_LEARNING_V1',
    '你是已完成课节后的补充学习助手。直接回应学习者当前问题，帮助其继续理解、澄清、迁移或深入讨论。',
    '固定学习上下文只有下方本课 Review；不得声称读取了原课堂对话、教学账本、画像或其他会话。',
    '补充学习不改变课程进度，也不生成 Review。只输出面向学习者的自然 Markdown，不输出内部状态或控制协议。',
    `【本课 Review】\n${reviewMarkdown.trim()}`,
    history === '' ? undefined : `【本轮补充学习会话】\n${history}`,
  ]
    .filter((section): section is string => section !== undefined)
    .join('\n\n');
}

export function createSupplementaryLearning(options: {
  sessions: SupplementarySessions;
  runtime: Runtime;
  execution: Execution;
  artifacts: Pick<
    ReturnType<typeof createMarkdownArtifactStore>,
    'saveDraft' | 'read' | 'readDraft'
  >;
  loadFinalReviewMarkdown(lessonId: string): Promise<string | undefined>;
  nextMessageId(): string;
  now(): Date;
  providerId: string;
}) {
  const completionByTask = new Map<string, Promise<void>>();
  const startByLesson = new Map<string, Promise<Awaited<ReturnType<typeof view>>>>();
  async function messages(sessionId: string) {
    const stored = await options.sessions.listMessages(sessionId);
    const session = await options.sessions.get(sessionId);
    const storedById = new Map(stored.map((message) => [message.id, message]));
    const source: readonly LearningMessage[] =
      session === undefined
        ? stored
        : session.messageIds.map(
            (messageId) =>
              storedById.get(messageId) ?? {
                id: messageId,
                role: 'user' as const,
                createdAt: session.updatedAt,
                contentArtifactRef: messageId,
                completionStatus: 'complete' as const,
              },
          );
    return Promise.all(
      source.map(async (message) => ({
        id: message.id,
        role: message.role,
        createdAt: message.createdAt,
        completionStatus: message.completionStatus,
        ...(message.generationTaskId === undefined
          ? {}
          : { generationTaskId: message.generationTaskId }),
        markdown:
          (await options.artifacts.read(message.contentArtifactRef))?.content ??
          (await options.artifacts.readDraft(message.contentArtifactRef)) ??
          '',
      })),
    );
  }

  async function completeTask(sessionId: string, taskId: string): Promise<void> {
    const task = await options.runtime.get(taskId);
    if (task.status === 'queued' || task.status === 'running') return;
    if (
      (task.status === 'completed' || task.status === 'cancelled') &&
      task.draftMarkdown?.trim()
    ) {
      const messageId = options.nextMessageId();
      await options.artifacts.saveDraft(messageId, task.draftMarkdown.trim());
      await options.sessions.execute({
        type: 'CommitSupplementaryReply',
        supplementarySessionId: sessionId,
        taskId,
        message: {
          id: messageId,
          role: 'assistant',
          createdAt: options.now().toISOString(),
          contentArtifactRef: messageId,
          generationTaskId: taskId,
          completionStatus: task.status === 'completed' ? 'complete' : 'interrupted',
        },
      });
      return;
    }
    await options.sessions.execute({
      type: 'FailSupplementaryGeneration',
      supplementarySessionId: sessionId,
      taskId,
      errorCode: task.errorCode ?? `supplementary_generation_${task.status}`,
    });
  }

  function coordinateCompletion(sessionId: string, taskId: string): Promise<void> {
    const existing = completionByTask.get(taskId);
    if (existing !== undefined) return existing;
    const pending = completeTask(sessionId, taskId).finally(() => completionByTask.delete(taskId));
    completionByTask.set(taskId, pending);
    return pending;
  }

  function finishInBackground(sessionId: string, taskId: string): void {
    void options.execution
      .awaitTerminal(taskId)
      .then(() => coordinateCompletion(sessionId, taskId))
      .catch(() => undefined);
  }

  async function reconcile(sessionId: string): Promise<void> {
    const session = await options.sessions.get(sessionId);
    if (session?.activeGenerationTaskId === undefined) return;
    await coordinateCompletion(sessionId, session.activeGenerationTaskId);
  }

  async function view(sessionId: string) {
    await reconcile(sessionId);
    const session = await options.sessions.get(sessionId);
    if (session === undefined) {
      throw Object.assign(new Error('supplementary_session_not_found'), {
        code: 'supplementary_session_not_found',
      });
    }
    return { ...session, messages: await messages(sessionId) };
  }

  async function promptFor(
    sessionId: string,
    input?: Readonly<{ replacedUserMessageId?: string; markdown?: string }>,
  ): Promise<string> {
    const session = await options.sessions.get(sessionId);
    if (session === undefined) throw new Error('supplementary_session_not_found');
    const review = await options.loadFinalReviewMarkdown(session.lessonId);
    if (review === undefined || review.trim() === '') {
      throw Object.assign(new Error('supplementary_review_unavailable'), {
        code: 'supplementary_review_unavailable',
      });
    }
    const stored = await messages(sessionId);
    const replacedIndex =
      input?.replacedUserMessageId === undefined
        ? -1
        : stored.findIndex(({ id }) => id === input.replacedUserMessageId);
    const effective = (replacedIndex < 0 ? stored : stored.slice(0, replacedIndex))
      .filter((message) => message.completionStatus === 'complete')
      .map(({ role, markdown }) => ({ role, markdown }));
    if (input?.markdown !== undefined) effective.push({ role: 'user', markdown: input.markdown });
    return renderPrompt(review, effective);
  }

  async function submitTurn(input: {
    sessionId: string;
    markdown?: string;
    expectedVersion: number;
    replacedUserMessageId?: string;
    retry?: boolean;
  }) {
    const prompt = await promptFor(input.sessionId, {
      ...(input.markdown === undefined ? {} : { markdown: input.markdown }),
      ...(input.replacedUserMessageId === undefined
        ? {}
        : { replacedUserMessageId: input.replacedUserMessageId }),
    });
    const task = await options.execution.submit({
      taskKey: `supplementary-learning:${input.sessionId}:${sha256(prompt)}`,
      inputSnapshotHash: sha256(prompt),
      taskKind: 'supplementary-learning',
      taskGroup: 'interactive',
      ownerRef: input.sessionId,
      providerId: options.providerId,
      reasoningEffort: 'medium',
      priority: 100,
      prompt,
    });
    try {
      const updated =
        input.retry === true
          ? await options.sessions.execute({
              type: 'RetrySupplementaryTurn',
              supplementarySessionId: input.sessionId,
              taskId: task.taskId,
              expectedVersion: input.expectedVersion,
            })
          : await (async () => {
              const messageId = options.nextMessageId();
              await options.artifacts.saveDraft(messageId, input.markdown!);
              return options.sessions.execute({
                type: 'StartSupplementaryTurn',
                supplementarySessionId: input.sessionId,
                taskId: task.taskId,
                expectedVersion: input.expectedVersion,
                ...(input.replacedUserMessageId === undefined
                  ? {}
                  : { replacedUserMessageId: input.replacedUserMessageId }),
                message: {
                  id: messageId,
                  role: 'user',
                  createdAt: options.now().toISOString(),
                  contentArtifactRef: messageId,
                  completionStatus: 'complete',
                },
              });
            })();
      finishInBackground(input.sessionId, task.taskId);
      return { taskId: task.taskId, resourceVersion: updated.resourceVersion };
    } catch (error) {
      await options.execution.cancel(task.taskId).catch(() => undefined);
      throw error;
    }
  }

  return {
    start(lessonId: string) {
      const existing = startByLesson.get(lessonId);
      if (existing !== undefined) return existing;
      const pending = (async () => {
        for await (const session of options.sessions.listByLesson(lessonId)) {
          if (session.status === 'active') return view(session.id);
        }
        const created = await options.sessions.execute({
          type: 'StartSupplementarySession',
          lessonId,
        });
        return { ...created, messages: [] };
      })().finally(() => startByLesson.delete(lessonId));
      startByLesson.set(lessonId, pending);
      return pending;
    },
    view,
    send(input: { sessionId: string; markdown: string; expectedVersion: number }) {
      return submitTurn(input);
    },
    revise(input: {
      sessionId: string;
      replacedUserMessageId: string;
      markdown: string;
      expectedVersion: number;
    }) {
      return submitTurn(input);
    },
    retry(input: { sessionId: string; expectedVersion: number }) {
      return submitTurn({ ...input, retry: true });
    },
    async rename(input: { sessionId: string; title: string; expectedVersion: number }) {
      const renamed = await options.sessions.execute({
        type: 'RenameSupplementarySession',
        supplementarySessionId: input.sessionId,
        title: input.title.trim(),
        expectedVersion: input.expectedVersion,
      });
      return { ...renamed, messages: await messages(input.sessionId) };
    },
    async stop(input: { sessionId: string; taskId: string }) {
      await options.execution.cancel(input.taskId);
      await coordinateCompletion(input.sessionId, input.taskId);
      return view(input.sessionId);
    },
    async archive(input: { sessionId: string; expectedVersion: number }) {
      const current = await options.sessions.get(input.sessionId);
      if (current === undefined) throw new Error('supplementary_session_not_found');
      if (current.resourceVersion !== input.expectedVersion) {
        throw Object.assign(new Error('version_conflict'), {
          code: 'version_conflict',
          currentVersion: current.resourceVersion,
        });
      }
      const archived = await options.sessions.execute({
        type: 'ArchiveSupplementarySession',
        supplementarySessionId: input.sessionId,
        expectedVersion: current.resourceVersion,
      });
      if (current.activeGenerationTaskId !== undefined) {
        await options.execution.cancel(current.activeGenerationTaskId).catch(() => undefined);
      }
      return { ...archived, messages: await messages(input.sessionId) };
    },
  };
}
