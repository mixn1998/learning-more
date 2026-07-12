import { randomUUID } from 'node:crypto';

import type { UnitOfWork } from '../../../persistence/unit-of-work.js';
import type { CourseAuthoringRepositories } from '../../../persistence/course-authoring-repositories.js';
import type { CourseMode } from '../model/commands.js';
import { createOutlineSession, decide, evolveAll } from '../model/outline-session.js';
import { compileCandidate, type CandidateInputManifest } from './outline-compiler.js';

export function createCourseAuthoringModule(options: {
  readonly repositories: CourseAuthoringRepositories;
  readonly unitOfWork: UnitOfWork;
  readonly generationRuntime: {
    submit(request: {
      taskKey: string;
      inputSnapshotHash: string;
      taskKind: string;
      taskGroup: 'interactive';
      ownerRef: string;
      providerId: string;
      priority: number;
      prompt: string;
    }): Promise<{ taskId: string }>;
  };
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
      let session = createOutlineSession(input);
      session = evolveAll(
        session,
        decide(session, {
          type: 'skipAssessment',
          assessmentArtifactId: input.assessmentArtifactId,
        }),
      );
      await options.unitOfWork.execute({ transactionId: `tx_authoring_${randomUUID()}` }, (tx) =>
        options.repositories.outlineSessions.save(
          tx,
          { session, resourceVersion: 0, candidateCommandReceipts: {} },
          0,
        ),
      );
      return session;
    },
    async requestCandidate(input: {
      commandId: string;
      outlineSessionId: string;
      inputSnapshotHash: string;
      promptInputArtifactRef: string;
    }) {
      const record = await options.repositories.outlineSessions.get(input.outlineSessionId);
      if (record === undefined) throw new Error('OUTLINE_SESSION_NOT_FOUND');
      const receipt = record.candidateCommandReceipts[input.commandId];
      if (receipt !== undefined) return receipt;
      const task = await options.generationRuntime.submit({
        taskKey: `outline-candidate:${input.outlineSessionId}:${input.commandId}`,
        inputSnapshotHash: input.inputSnapshotHash,
        taskKind: 'outline-candidate',
        taskGroup: 'interactive',
        ownerRef: input.outlineSessionId,
        providerId: options.providerId ?? 'current',
        priority: 100,
        prompt: JSON.stringify({
          templateRef: 'course-outline-candidate@v1',
          inputArtifactRef: input.promptInputArtifactRef,
        }),
      });
      const session = evolveAll(
        record.session,
        decide(record.session, {
          type: 'requestCandidate',
          generationTaskId: task.taskId,
        }),
      );
      await options.unitOfWork.execute({ transactionId: `tx_authoring_${randomUUID()}` }, (tx) =>
        options.repositories.outlineSessions.save(
          tx,
          {
            session,
            resourceVersion: record.resourceVersion,
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
