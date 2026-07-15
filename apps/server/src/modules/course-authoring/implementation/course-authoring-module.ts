import { randomUUID } from 'node:crypto';

import type { UnitOfWork } from '../../../persistence/unit-of-work.js';
import type { CourseAuthoringRepositories } from '../../../persistence/course-authoring-repositories.js';
import type { GenerationRuntime } from '../../generation-runtime/interface.js';
import type { CourseMode } from '../model/commands.js';
import type { OutlineMessage } from '../model/outline-message.js';
import { createOutlineSession, decide, evolveAll } from '../model/outline-session.js';
import { compileCandidate, type CandidateInputManifest } from './outline-compiler.js';
import { buildCandidateGenerationPrompt } from './candidate-output-contract.js';
import type { CandidatePromptInput } from './prompt-input-builder.js';

type GenerationRuntimeDependency = Pick<GenerationRuntime, 'submit'> &
  Partial<Pick<GenerationRuntime, 'get' | 'cancel' | 'recoverExpiredLeases'>>;

export function createCourseAuthoringModule(options: {
  readonly repositories: CourseAuthoringRepositories;
  readonly unitOfWork: UnitOfWork;
  readonly generationRuntime: GenerationRuntimeDependency;
  readonly draftStore: { saveDraft(artifactRef: string, markdown: string): Promise<void> };
  readonly providerId?: string;
  readonly now?: () => Date;
}) {
  const now = options.now ?? (() => new Date());
  return {
    async createOutlineSession(input: {
      outlineSessionId: string;
      courseMode: CourseMode;
      topic: string;
      assessmentArtifactId: string;
    }) {
      let session = createOutlineSession({
        outlineSessionId: input.outlineSessionId,
        courseMode: input.courseMode,
        topic: input.topic,
      });
      session = evolveAll(session, decide(session, { type: 'startAssessment' }));
      const messages: OutlineMessage[] = [];
      for (let round = 1; round <= 3; round += 1) {
        const userMessageId = `${input.assessmentArtifactId}:user:${round}`;
        const assistantMessageId = `${input.assessmentArtifactId}:assistant:${round}`;
        session = evolveAll(
          session,
          decide(session, { type: 'startAssessmentTurn', userMessageId }),
        );
        session = evolveAll(
          session,
          decide(session, {
            type: 'completeAssessmentTurn',
            userMessageId,
            assistantMessageId,
          }),
        );
        messages.push(
          {
            messageId: userMessageId,
            role: 'user' as const,
            content: input.topic,
            status: 'complete' as const,
            createdAt: now().toISOString(),
          },
          {
            messageId: assistantMessageId,
            role: 'assistant' as const,
            content: 'Assessment acknowledged.',
            status: 'complete' as const,
            createdAt: now().toISOString(),
            inReplyToMessageId: userMessageId,
          },
        );
      }
      await options.unitOfWork.execute({ transactionId: `tx_authoring_${randomUUID()}` }, (tx) =>
        options.repositories.outlineSessions.save(
          tx,
          {
            session,
            resourceVersion: 0,
            candidateCommandReceipts: {},
            messages,
          },
          0,
        ),
      );
      return session;
    },
    async requestCandidate(input: {
      commandId: string;
      outlineSessionId: string;
      inputSnapshotHash: string;
      promptInput?: CandidatePromptInput;
      promptInputArtifactRef?: string;
    }) {
      let record = await options.repositories.outlineSessions.get(input.outlineSessionId);
      if (record === undefined) throw new Error('OUTLINE_SESSION_NOT_FOUND');
      const receipt = record.candidateCommandReceipts[input.commandId];
      if (receipt !== undefined) return receipt;
      if (record.session.completedAssessmentRounds < 3) {
        throw new Error('assessment_required');
      }
      let reusableTask: { taskId: string } | undefined;
      if (record.session.state === 'generating-candidates') {
        const activeTaskId = record.session.activeCandidateTaskId;
        const getTask = options.generationRuntime.get;
        const cancelTask = options.generationRuntime.cancel;
        const recoverExpiredLeases = options.generationRuntime.recoverExpiredLeases;
        if (activeTaskId === undefined || getTask === undefined || cancelTask === undefined) {
          throw new Error('generation_in_progress');
        }
        await recoverExpiredLeases?.();
        const activeTask = await getTask(activeTaskId);
        const leaseExpired =
          activeTask.leaseExpiresAt !== undefined &&
          new Date(activeTask.leaseExpiresAt).getTime() < now().getTime();
        const hadRunningAttempt = activeTask.attempts?.at(-1)?.status === 'running';
        if (activeTask.status === 'queued' && !hadRunningAttempt && !leaseExpired) {
          reusableTask = { taskId: activeTaskId };
        } else if (
          !leaseExpired ||
          !hadRunningAttempt ||
          !['queued', 'running'].includes(activeTask.status)
        ) {
          throw new Error('generation_in_progress');
        }
        if (reusableTask === undefined) {
          await cancelTask(activeTaskId);
          record = {
            ...record,
            session: evolveAll(
              record.session,
              decide(record.session, {
                type: 'candidateGenerationFailed',
                generationTaskId: activeTaskId,
              }),
            ),
          };
        }
      }
      const promptInput: CandidatePromptInput = input.promptInput ?? {
        courseDirection: record.session.topic,
        learningApproach:
          '以学习者当前选择的方式作为关注重心，同时允许根据问题跨越解释、案例、论证和决策分析。',
        conversation: record.messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
        sources: [
          {
            sourceRef: 'source_topic',
            title: 'Initial course direction',
            excerpt: record.session.topic,
          },
        ],
      };
      const task =
        reusableTask ??
        (await options.generationRuntime.submit({
          taskKey: `outline-candidate:${input.outlineSessionId}:${input.commandId}`,
          inputSnapshotHash: input.inputSnapshotHash,
          taskKind: 'outline-candidate',
          taskGroup: 'interactive',
          ownerRef: input.outlineSessionId,
          providerId: options.providerId ?? 'current',
          priority: 100,
          prompt: buildCandidateGenerationPrompt(promptInput),
        }));
      const session =
        reusableTask === undefined
          ? evolveAll(
              record.session,
              decide(record.session, {
                type: 'requestCandidate',
                generationTaskId: task.taskId,
              }),
            )
          : record.session;
      await options.unitOfWork.execute({ transactionId: `tx_authoring_${randomUUID()}` }, (tx) =>
        options.repositories.outlineSessions.save(
          tx,
          {
            ...record,
            session,
            candidateCommandReceipts: {
              ...record.candidateCommandReceipts,
              [input.commandId]: task,
            },
          },
          record.resourceVersion,
        ),
      );
      void now;
      return task;
    },
    async completeCandidate(input: {
      outlineSessionId: string;
      generationTaskId: string;
      candidateVersionId: string;
      draftArtifactRef: string;
      markdown: string;
      inputManifest: CandidateInputManifest;
    }) {
      const record = await options.repositories.outlineSessions.get(input.outlineSessionId);
      if (record === undefined) throw new Error('OUTLINE_SESSION_NOT_FOUND');
      await options.draftStore.saveDraft(input.draftArtifactRef, input.markdown);
      const compiled = compileCandidate(input.markdown, input.inputManifest);
      if (!compiled.valid) {
        const session = evolveAll(
          record.session,
          decide(record.session, {
            type: 'candidateGenerationFailed',
            generationTaskId: input.generationTaskId,
          }),
        );
        await options.unitOfWork.execute({ transactionId: `tx_authoring_${randomUUID()}` }, (tx) =>
          options.repositories.outlineSessions.save(
            tx,
            { ...record, session },
            record.resourceVersion,
          ),
        );
        return compiled;
      }
      const session = evolveAll(
        record.session,
        decide(record.session, {
          type: 'candidateGenerated',
          generationTaskId: input.generationTaskId,
          candidateVersionId: input.candidateVersionId,
        }),
      );
      const parentVersionId = record.session.latestCandidateVersionId;
      await options.unitOfWork.execute(
        { transactionId: `tx_authoring_${randomUUID()}` },
        async (tx) => {
          await options.repositories.candidateVersions.save(
            tx,
            {
              id: input.candidateVersionId,
              outlineSessionId: input.outlineSessionId,
              ...(parentVersionId === undefined ? {} : { parentVersionId }),
              generationTaskId: input.generationTaskId,
              draftArtifactRef: input.draftArtifactRef,
              candidate: compiled.candidate,
              createdAt: now().toISOString(),
              resourceVersion: 0,
            },
            0,
          );
          await options.repositories.outlineSessions.save(
            tx,
            { ...record, session },
            record.resourceVersion,
          );
        },
      );
      return { ...compiled, candidateVersionId: input.candidateVersionId };
    },
    async failCandidateGeneration(input: {
      outlineSessionId: string;
      generationTaskId: string;
      draftArtifactRef: string;
      partialMarkdown: string;
    }) {
      const record = await options.repositories.outlineSessions.get(input.outlineSessionId);
      if (record === undefined) throw new Error('OUTLINE_SESSION_NOT_FOUND');
      await options.draftStore.saveDraft(input.draftArtifactRef, input.partialMarkdown);
      const session = evolveAll(
        record.session,
        decide(record.session, {
          type: 'candidateGenerationFailed',
          generationTaskId: input.generationTaskId,
        }),
      );
      await options.unitOfWork.execute({ transactionId: `tx_authoring_${randomUUID()}` }, (tx) =>
        options.repositories.outlineSessions.save(
          tx,
          { ...record, session },
          record.resourceVersion,
        ),
      );
    },
  };
}
