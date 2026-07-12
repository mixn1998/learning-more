import { createHash } from 'node:crypto';

import type { ApplicationProblem } from '@learning-more/contracts';

import type { CourseAuthoringRepositories } from '../../../persistence/course-authoring-repositories.js';
import type { GenerationFrameLog, GenerationRuntime } from '../../generation-runtime/interface.js';
import type { CandidateGenerationCoordinator } from './course-authoring-facade.js';
import type { createCourseAuthoringModule } from './course-authoring-module.js';

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function problem(taskId: string, code: 'ai_unavailable' | 'candidate_invalid'): ApplicationProblem {
  return {
    type: `https://learning-more.local/problems/${code.replaceAll('_', '-')}`,
    status: code === 'candidate_invalid' ? 422 : 503,
    code,
    messageKey: code === 'candidate_invalid' ? 'errors.candidateInvalid' : 'errors.aiUnavailable',
    retryable: true,
    correlationId: taskId,
    recovery: { action: 'retry', resourceRef: taskId },
  };
}

export function createCandidateGenerationCoordinator(options: {
  readonly module: ReturnType<typeof createCourseAuthoringModule>;
  readonly repositories: CourseAuthoringRepositories;
  readonly runtime: GenerationRuntime;
  readonly frameLog: GenerationFrameLog;
  readonly nextCandidateId: () => string;
}): CandidateGenerationCoordinator {
  return {
    async generate(input) {
      const before = await options.repositories.outlineSessions.get(input.outlineSessionId);
      if (before === undefined) throw new Error('OUTLINE_SESSION_NOT_FOUND');
      const inputSnapshotHash = sha256(JSON.stringify(before.session));
      const task = await options.module.requestCandidate({
        commandId: input.commandId,
        outlineSessionId: input.outlineSessionId,
        inputSnapshotHash,
        promptInputArtifactRef: `prompt-input:${inputSnapshotHash}`,
      });
      const draftArtifactRef = `draft_${task.taskId}`;
      await options.frameLog.ensureTask(task.taskId, 'running');
      await options.runtime.runNext();
      const completedTask = await options.runtime.get(task.taskId);
      const markdown = completedTask.draftMarkdown ?? '';
      const messageId = `message_${sha256(task.taskId).slice(0, 24)}`;
      if (markdown.length > 0) {
        await options.frameLog.append(task.taskId, 'message.started', { messageId });
        await options.frameLog.append(task.taskId, 'message.delta', { messageId, markdown });
        await options.frameLog.append(task.taskId, 'message.completed', {
          messageId,
          contentSha256: sha256(markdown),
        });
      }

      if (completedTask.status !== 'completed') {
        await options.module.failCandidateGeneration({
          outlineSessionId: input.outlineSessionId,
          generationTaskId: task.taskId,
          draftArtifactRef,
          partialMarkdown: markdown,
        });
        await options.frameLog.append(task.taskId, 'task.failed', {
          problem: problem(task.taskId, 'ai_unavailable'),
        });
        const after = await options.repositories.outlineSessions.get(input.outlineSessionId);
        if (after === undefined) throw new Error('OUTLINE_SESSION_NOT_FOUND');
        return {
          taskId: task.taskId,
          state: 'failed_recoverable',
          resourceVersion: after.resourceVersion,
          draftArtifactRef,
        };
      }

      const candidateVersionId = options.nextCandidateId();
      const compiled = await options.module.completeCandidate({
        outlineSessionId: input.outlineSessionId,
        generationTaskId: task.taskId,
        candidateVersionId,
        draftArtifactRef,
        markdown,
        inputManifest: { draftArtifactRef, sourceRefs: ['source_topic'] },
      });
      const after = await options.repositories.outlineSessions.get(input.outlineSessionId);
      if (after === undefined) throw new Error('OUTLINE_SESSION_NOT_FOUND');
      if (!compiled.valid) {
        await options.frameLog.append(task.taskId, 'task.failed', {
          problem: problem(task.taskId, 'candidate_invalid'),
        });
        return {
          taskId: task.taskId,
          state: 'failed_recoverable',
          resourceVersion: after.resourceVersion,
          draftArtifactRef,
        };
      }
      await options.frameLog.append(task.taskId, 'artifact.ready', {
        artifactId: candidateVersionId,
        kind: 'outline-candidate',
        contentSha256: sha256(markdown),
      });
      await options.frameLog.append(task.taskId, 'task.completed', {
        resultRef: `outline-candidate:${candidateVersionId}`,
      });
      return {
        taskId: task.taskId,
        state: 'running',
        resourceVersion: after.resourceVersion,
        draftArtifactRef,
      };
    },
  };
}
