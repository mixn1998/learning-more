import { createHash } from 'node:crypto';

import type { ApplicationProblem, CandidateGenerationFailureCode } from '@learning-more/contracts';

import type { CourseAuthoringRepositories } from '../../../persistence/course-authoring-repositories.js';
import type {
  GenerationExecution,
  GenerationFrameLog,
  GenerationRuntime,
} from '../../generation-runtime/interface.js';
import type { CandidateGenerationCoordinator } from './course-authoring-facade.js';
import type { createCourseAuthoringModule } from './course-authoring-module.js';
import { createAuthoringContextAssembler } from './authoring-context-assembler.js';
import { buildCandidatePromptInput } from './prompt-input-builder.js';
import type { CompletedLessonOutlineContext } from '../ports/authoring-agent.js';

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function problem(
  taskId: string,
  code: 'ai_unavailable' | 'candidate_invalid' | 'generation_timeout',
): ApplicationProblem {
  return {
    type: `https://learning-more.local/problems/${code.replaceAll('_', '-')}`,
    status: code === 'candidate_invalid' ? 422 : code === 'generation_timeout' ? 504 : 503,
    code,
    messageKey:
      code === 'candidate_invalid'
        ? 'errors.candidateInvalid'
        : code === 'generation_timeout'
          ? 'errors.generationTimeout'
          : 'errors.aiUnavailable',
    retryable: true,
    correlationId: taskId,
    recovery: { action: 'retry', resourceRef: taskId },
  };
}

function runtimeFailureCode(task: {
  readonly status: string;
  readonly errorCode?: string | undefined;
}): CandidateGenerationFailureCode {
  return task.status === 'timeout' || task.errorCode === 'generation_timeout'
    ? 'generation_timeout'
    : 'generation_interrupted';
}

export function createCandidateGenerationCoordinator(options: {
  readonly module: ReturnType<typeof createCourseAuthoringModule>;
  readonly repositories: CourseAuthoringRepositories;
  readonly runtime: GenerationRuntime;
  readonly execution: GenerationExecution;
  readonly frameLog: GenerationFrameLog;
  readonly nextCandidateId: () => string;
  readonly listCompletedLessonOutlineContexts?: (
    courseId: string,
  ) => Promise<readonly CompletedLessonOutlineContext[]>;
  readonly dispatchBackground?: (work: () => Promise<void>) => void;
}): CandidateGenerationCoordinator {
  const assembleAuthoringContext = createAuthoringContextAssembler(options.repositories, {
    ...(options.listCompletedLessonOutlineContexts === undefined
      ? {}
      : {
          listCompletedLessonOutlineContexts: options.listCompletedLessonOutlineContexts,
        }),
  });
  const activeFinalizations = new Map<string, Promise<void>>();
  const dispatchBackground =
    options.dispatchBackground ??
    ((work: () => Promise<void>) => {
      queueMicrotask(() => void work());
    });

  async function appendTerminalOnce(
    taskId: string,
    type: 'task.completed' | 'task.failed' | 'task.cancelled',
    data: Record<string, unknown>,
  ): Promise<void> {
    const replay = await options.frameLog.readAfter(taskId, Number.MAX_SAFE_INTEGER);
    if (replay.meta.state !== 'running') return;
    await options.frameLog.append(taskId, type, data);
  }

  async function failActiveSession(input: {
    outlineSessionId: string;
    taskId: string;
    draftArtifactRef: string;
    markdown: string;
  }): Promise<boolean> {
    const record = await options.repositories.outlineSessions.get(input.outlineSessionId);
    if (
      record?.session.state !== 'generating-candidates' ||
      record.session.activeCandidateTaskId !== input.taskId
    ) {
      return false;
    }
    await options.module.failCandidateGeneration({
      outlineSessionId: input.outlineSessionId,
      generationTaskId: input.taskId,
      draftArtifactRef: input.draftArtifactRef,
      partialMarkdown: input.markdown,
    });
    return true;
  }

  async function finalizeCandidate(input: {
    outlineSessionId: string;
    taskId: string;
    promptInput: ReturnType<typeof buildCandidatePromptInput>;
  }): Promise<void> {
    const draftArtifactRef = `draft_${input.taskId}`;
    try {
      const completedTask = await options.execution.awaitTerminal(input.taskId);
      const markdown = completedTask.draftMarkdown ?? '';
      const messageId = `message_${sha256(input.taskId).slice(0, 24)}`;
      if (markdown.length > 0) {
        await options.frameLog.append(input.taskId, 'message.started', { messageId });
        await options.frameLog.append(input.taskId, 'message.delta', { messageId, markdown });
        await options.frameLog.append(input.taskId, 'message.completed', {
          messageId,
          contentSha256: sha256(markdown),
        });
      }

      if (completedTask.status === 'cancelled') {
        await failActiveSession({ ...input, draftArtifactRef, markdown });
        await appendTerminalOnce(input.taskId, 'task.cancelled', { reason: 'user_cancelled' });
        return;
      }

      if (completedTask.status !== 'completed') {
        const failureCode = runtimeFailureCode(completedTask);
        await failActiveSession({ ...input, draftArtifactRef, markdown });
        await appendTerminalOnce(input.taskId, 'task.failed', {
          problem: problem(
            input.taskId,
            failureCode === 'generation_timeout' ? 'generation_timeout' : 'ai_unavailable',
          ),
        });
        return;
      }

      const candidateVersionId = options.nextCandidateId();
      const compiled = await options.module.completeCandidate({
        outlineSessionId: input.outlineSessionId,
        generationTaskId: input.taskId,
        candidateVersionId,
        draftArtifactRef,
        markdown,
        inputManifest: {
          draftArtifactRef,
          sourceRefs: input.promptInput.sources.map((source) => source.sourceRef),
        },
      });
      if (!compiled.valid) {
        await appendTerminalOnce(input.taskId, 'task.failed', {
          problem: problem(input.taskId, 'candidate_invalid'),
        });
        return;
      }
      await options.frameLog.append(input.taskId, 'artifact.ready', {
        artifactId: candidateVersionId,
        kind: 'outline-candidate',
        contentSha256: sha256(markdown),
      });
      await appendTerminalOnce(input.taskId, 'task.completed', {
        resultRef: `outline-candidate:${candidateVersionId}`,
      });
    } catch {
      await failActiveSession({
        outlineSessionId: input.outlineSessionId,
        taskId: input.taskId,
        draftArtifactRef,
        markdown: '',
      }).catch(() => false);
      await appendTerminalOnce(input.taskId, 'task.failed', {
        problem: problem(input.taskId, 'ai_unavailable'),
      }).catch(() => undefined);
    }
  }

  function startFinalization(input: {
    outlineSessionId: string;
    taskId: string;
    promptInput: ReturnType<typeof buildCandidatePromptInput>;
  }): Promise<void> {
    const existing = activeFinalizations.get(input.taskId);
    if (existing !== undefined) return existing;
    let resolveCompletion!: () => void;
    const completion = new Promise<void>((resolve) => {
      resolveCompletion = resolve;
    });
    activeFinalizations.set(input.taskId, completion);
    dispatchBackground(async () => {
      try {
        await finalizeCandidate(input);
      } finally {
        activeFinalizations.delete(input.taskId);
        resolveCompletion();
      }
    });
    return completion;
  }

  return {
    async generate(input) {
      const before = await options.repositories.outlineSessions.get(input.outlineSessionId);
      if (before === undefined) throw new Error('OUTLINE_SESSION_NOT_FOUND');
      const promptInput = buildCandidatePromptInput(
        await assembleAuthoringContext(input.outlineSessionId),
      );
      const inputSnapshotHash = sha256(JSON.stringify(promptInput));
      const task = await options.module.requestCandidate({
        commandId: input.commandId,
        outlineSessionId: input.outlineSessionId,
        inputSnapshotHash,
        promptInput,
      });
      const draftArtifactRef = `draft_${task.taskId}`;
      await options.frameLog.ensureTask(task.taskId, 'running');
      const after = await options.repositories.outlineSessions.get(input.outlineSessionId);
      if (after === undefined) throw new Error('OUTLINE_SESSION_NOT_FOUND');
      void startFinalization({
        outlineSessionId: input.outlineSessionId,
        taskId: task.taskId,
        promptInput,
      });
      return {
        taskId: task.taskId,
        state: 'running',
        resourceVersion: after.resourceVersion,
        draftArtifactRef,
      };
    },
    async recover(input) {
      const record = await options.repositories.outlineSessions.get(input.outlineSessionId);
      if (record === undefined) throw new Error('OUTLINE_SESSION_NOT_FOUND');
      if (
        record.session.state !== 'generating-candidates' ||
        record.session.activeCandidateTaskId !== input.taskId
      ) {
        return;
      }
      const promptInput = buildCandidatePromptInput(
        await assembleAuthoringContext(input.outlineSessionId),
      );
      await options.frameLog.ensureTask(input.taskId, 'running');
      await startFinalization({
        outlineSessionId: input.outlineSessionId,
        taskId: input.taskId,
        promptInput,
      });
    },
    async cancel(input) {
      const record = await options.repositories.outlineSessions.get(input.outlineSessionId);
      if (record === undefined) throw new Error('OUTLINE_SESSION_NOT_FOUND');
      const taskId = record.session.activeCandidateTaskId;
      if (taskId === undefined) throw new Error('generation_not_in_progress');
      const task = await options.runtime.cancel(taskId);
      if (task.status === 'queued' || task.status === 'running') {
        throw new Error('generation_cancel_pending');
      }
      await options.module.failCandidateGeneration({
        outlineSessionId: input.outlineSessionId,
        generationTaskId: taskId,
        draftArtifactRef: `draft_${taskId}`,
        partialMarkdown: task.draftMarkdown ?? '',
      });
      await options.frameLog.append(taskId, 'task.cancelled', { reason: 'user_cancelled' });
      const after = await options.repositories.outlineSessions.get(input.outlineSessionId);
      if (after === undefined) throw new Error('OUTLINE_SESSION_NOT_FOUND');
      return {
        taskId,
        state: 'failed_recoverable' as const,
        failureCode: 'generation_interrupted' as const,
        resourceVersion: after.resourceVersion,
      };
    },
  };
}
