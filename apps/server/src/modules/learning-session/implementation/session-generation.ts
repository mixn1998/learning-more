import { createHash } from 'node:crypto';

import type { CommandContext } from '@learning-more/contracts';

import type { GenerationFrameLog, GenerationRuntime } from '../../generation-runtime/interface.js';
import type {
  LearningSessionModule,
  SessionGenerationCoordinator,
  SessionGenerationInputManifest,
} from '../interface.js';

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function createSessionGenerationCoordinator(options: {
  readonly runtime: GenerationRuntime;
  readonly sessionModule: LearningSessionModule;
  readonly frameLog: Pick<GenerationFrameLog, 'ensureTask' | 'append'>;
  readonly artifactStore: {
    saveDraft(artifactRef: string, markdown: string): Promise<void>;
    saveManifest(manifest: SessionGenerationInputManifest): Promise<string>;
  };
  readonly providerId: string;
  readonly nextMessageId: () => string;
}): SessionGenerationCoordinator {
  const started = new Set<string>();

  async function finish(taskId: string, lessonId: string, context: CommandContext): Promise<void> {
    await options.runtime.runNext();
    const task = await options.runtime.get(taskId);
    if (task.status === 'cancelled') return;
    const markdown = task.draftMarkdown ?? '';
    const draftArtifactRef = `draft_${taskId}`;
    await options.artifactStore.saveDraft(draftArtifactRef, markdown);
    if (task.status !== 'completed') {
      await options.frameLog.append(taskId, 'task.failed', {
        problem: {
          type: 'https://learning-more.local/problems/ai-unavailable',
          status: 503,
          code: 'ai_unavailable',
          messageKey: 'errors.aiUnavailable',
          retryable: true,
          correlationId: context.correlationId,
          recovery: { action: 'retry', resourceRef: taskId },
        },
      });
      return;
    }
    const messageId = options.nextMessageId();
    await options.frameLog.append(taskId, 'message.started', { messageId });
    if (markdown.length > 0) {
      await options.frameLog.append(taskId, 'message.delta', { messageId, markdown });
    }
    await options.frameLog.append(taskId, 'message.completed', {
      messageId,
      contentSha256: sha256(markdown),
    });
    await options.sessionModule.execute(
      {
        type: 'CommitAssistantMessage',
        lessonId,
        messageId,
        contentArtifactRef: draftArtifactRef,
        generationTaskId: taskId,
      },
      { ...context, commandId: `${context.commandId}:assistant` },
    );
    await options.frameLog.append(taskId, 'artifact.ready', {
      artifactId: draftArtifactRef,
      kind: 'assistant-message',
      contentSha256: sha256(markdown),
    });
    await options.frameLog.append(taskId, 'task.completed', {
      resultRef: draftArtifactRef,
    });
  }

  return {
    async request(input: SessionGenerationInputManifest, context: CommandContext) {
      const manifestRef = await options.artifactStore.saveManifest(input);
      const inputSnapshotHash = sha256(JSON.stringify(input));
      const task = await options.runtime.submit({
        taskKey: `lesson-message:${input.sessionId}:${input.userMessageId}`,
        inputSnapshotHash,
        taskKind: 'lesson-response',
        taskGroup: 'interactive',
        ownerRef: input.sessionId,
        providerId: options.providerId,
        priority: 100,
        prompt: JSON.stringify({
          templateRef: 'lesson-response@v1',
          inputArtifactRef: manifestRef,
        }),
      });
      const startedGeneration = await options.sessionModule.execute(
        { type: 'StartSessionGeneration', lessonId: input.lessonId, taskId: task.taskId },
        context,
      );
      await options.frameLog.ensureTask(task.taskId, 'running');
      if (!started.has(task.taskId)) {
        started.add(task.taskId);
        void finish(task.taskId, input.lessonId, context).finally(() =>
          started.delete(task.taskId),
        );
      }
      return { taskId: task.taskId, resourceVersion: startedGeneration.value.resourceVersion };
    },
    async stop(
      input: { lessonId: string; sessionId: string; taskId: string },
      context: CommandContext,
    ) {
      const task = await options.runtime.cancel(input.taskId);
      const draftArtifactRef = `draft_${input.taskId}`;
      await options.artifactStore.saveDraft(draftArtifactRef, task.draftMarkdown ?? '');
      const stopped = await options.sessionModule.execute(
        { type: 'StopSessionGeneration', lessonId: input.lessonId },
        context,
      );
      await options.frameLog.append(input.taskId, 'task.cancelled', {
        reason: 'user_requested',
      });
      return {
        taskId: input.taskId,
        draftArtifactRef,
        resourceVersion: stopped.value.resourceVersion,
      };
    },
  };
}
