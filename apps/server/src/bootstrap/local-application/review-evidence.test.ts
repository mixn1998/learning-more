import { describe, expect, it, vi } from 'vitest';

import type { LocalLearningRuntime } from './learning-runtime.js';
import { createReviewEvidence } from './review-evidence.js';

describe('review evidence', () => {
  it('maps short evidence aliases and drops only invalid references', () => {
    const evidence = createReviewEvidence(
      {
        access: { teachingContextSources: {} },
      } as unknown as Pick<LocalLearningRuntime, 'access'>,
      {
        read: vi.fn(),
        readDraft: vi.fn(),
      },
    );

    const normalized = evidence.normalizeRefs(
      {
        schemaVersion: 1,
        kind: 'lesson-final',
        title: 'Review',
        knowledgeMap: {
          title: 'Map',
          markdown: 'A → B',
          evidenceRefs: ['E1', 'E99', 'message:message_ai_1', 'message:message_invented'],
        },
        coreInsight: 'Insight',
        performance: [{ title: 'Done', markdown: 'Evidence', evidenceRefs: ['e2'] }],
      },
      'lesson-final',
      ['message_user_1', 'message_ai_1'],
    );

    expect(normalized).toMatchObject({
      knowledgeMap: {
        evidenceRefs: ['message:message_user_1', 'message:message_ai_1'],
      },
      performance: [{ evidenceRefs: ['message:message_ai_1'] }],
    });
  });

  it('keeps the evidence gate when every supplied reference is invalid', () => {
    const evidence = createReviewEvidence(
      {
        access: { teachingContextSources: {} },
      } as unknown as Pick<LocalLearningRuntime, 'access'>,
      {
        read: vi.fn(),
        readDraft: vi.fn(),
      },
    );

    expect(() =>
      evidence.normalizeRefs(
        {
          schemaVersion: 1,
          kind: 'lesson-final',
          title: 'Review',
          knowledgeMap: {
            title: 'Map',
            markdown: 'A → B',
            evidenceRefs: ['E99'],
          },
          coreInsight: 'Insight',
          performance: [{ title: 'Done', markdown: 'Evidence' }],
        },
        'lesson-final',
        ['message_user_1'],
      ),
    ).toThrow('review_document_evidence_refs_unusable');
  });

  it('materializes the raw message log so checkpoint source ids survive retry projection collapse', async () => {
    const sourceSnapshotHash = 'a'.repeat(64);
    const checkpoint = {
      checkpointId: 'checkpoint_1',
      reason: 'lesson_closure' as const,
      lessonId: 'lesson_1',
      sessionId: 'session_1',
      teachingState: {
        schemaVersion: 1 as const,
        lessonId: 'lesson_1',
        sessionId: 'session_1',
        ledgerVersion: 1,
        sourceSnapshotHash,
        observationStatus: 'current' as const,
        scopeStatus: 'aligned' as const,
        evidenceCheckpoint: true,
        knowledgePoints: [],
        openLoops: [],
        explorationBranches: [],
        recentLearnerSignals: [],
      },
      observationRefs: [],
      sourceMessageIds: ['message_user_original', 'message_user_retry'],
      sourceSnapshotHash,
      observationCompleteness: 'complete' as const,
      retentionDecision: 'preserve' as const,
      frozenAt: '2026-07-20T00:00:00.000Z',
    };
    const learning = {
      access: {
        teachingContextSources: {
          getCourseAndLesson: vi.fn().mockResolvedValue({
            course: {
              courseId: 'course_1',
              outlineVersionId: 'outline_1',
              title: 'Course',
              goals: [],
              lessonMap: [],
            },
            lesson: {
              lessonId: 'lesson_1',
              outlineVersionId: 'outline_1',
              title: 'Lesson',
              objective: 'Objective',
              coreKnowledgePoints: [],
            },
          }),
          listMessages: vi.fn().mockResolvedValue([
            {
              messageId: 'message_user_retry',
              role: 'user',
              completionStatus: 'complete',
              markdown: 'same answer',
              sourceRef: 'message:message_user_retry',
            },
          ]),
        },
        getTeachingLedger: vi.fn().mockResolvedValue({
          courseId: 'course_1',
          lessonId: 'lesson_1',
          sessionId: 'session_1',
          observations: [],
          checkpoints: [checkpoint],
          state: checkpoint.teachingState,
          resourceVersion: 1,
        }),
        listMessages: vi.fn().mockResolvedValue([
          {
            id: 'message_user_original',
            role: 'user',
            createdAt: '2026-07-20T00:00:00.000Z',
            contentArtifactRef: 'artifact_original',
            completionStatus: 'complete',
          },
          {
            id: 'message_user_retry',
            role: 'user',
            createdAt: '2026-07-20T00:00:01.000Z',
            contentArtifactRef: 'artifact_retry',
            completionStatus: 'complete',
          },
        ]),
      },
    } as unknown as Pick<LocalLearningRuntime, 'access'>;
    const evidence = createReviewEvidence(learning, {
      read: vi.fn(async (artifactId: string) => ({
        artifactId,
        kind: 'message',
        contentSha256: 'b'.repeat(64),
        immutable: true,
        content: 'same answer',
      })),
      readDraft: vi.fn().mockResolvedValue(undefined),
    });

    const pack = await evidence.build('final', 'session_1', sourceSnapshotHash);

    expect(pack.messages.map((message) => message.messageId)).toEqual([
      'message_user_original',
      'message_user_retry',
    ]);
  });
});
