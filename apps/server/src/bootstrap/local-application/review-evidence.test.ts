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

  it('materializes the classroom summary and comprehensive synthesis for semantic distillation', async () => {
    const sourceSnapshotHash = 'c'.repeat(64);
    const teachingState = {
      schemaVersion: 1 as const,
      lessonId: 'lesson_1',
      sessionId: 'session_1',
      ledgerVersion: 3,
      sourceSnapshotHash,
      observationStatus: 'current' as const,
      scopeStatus: 'aligned' as const,
      evidenceCheckpoint: true,
      lessonPhase: 'ready_to_close' as const,
      comprehensiveCheck: 'completed' as const,
      closureInquiry: 'confirmed_no_questions' as const,
      summaryStatus: 'delivered' as const,
      reviewProjection: {
        comprehensiveApplicationStartSourceMessageId: 'message_comprehensive_start',
        comprehensiveSynthesisSourceMessageId: 'message_comprehensive_end',
        classroomSummarySourceMessageId: 'message_summary',
      },
      knowledgePoints: [],
      openLoops: [],
      explorationBranches: [],
      recentLearnerSignals: [],
    };
    const checkpoint = {
      checkpointId: 'checkpoint_1',
      reason: 'lesson_closure' as const,
      lessonId: 'lesson_1',
      sessionId: 'session_1',
      teachingState,
      observationRefs: [],
      sourceMessageIds: [
        'message_comprehensive_start',
        'message_comprehensive_end',
        'message_summary',
      ],
      sourceSnapshotHash,
      observationCompleteness: 'complete' as const,
      retentionDecision: 'preserve' as const,
      frozenAt: '2026-07-25T00:00:00.000Z',
    };
    const learning = {
      access: {
        teachingContextSources: {
          getCourseAndLesson: vi.fn().mockResolvedValue({
            course: { courseId: 'course_1', title: 'Course' },
            lesson: {
              lessonId: 'lesson_1',
              title: 'Lesson',
              objective: 'Objective',
              coreKnowledgePoints: [],
            },
          }),
        },
        getTeachingLedger: vi.fn().mockResolvedValue({
          courseId: 'course_1',
          lessonId: 'lesson_1',
          sessionId: 'session_1',
          observations: [],
          checkpoints: [checkpoint],
          state: teachingState,
          resourceVersion: 3,
        }),
        listMessages: vi.fn().mockResolvedValue([
          {
            id: 'message_comprehensive_start',
            role: 'assistant',
            createdAt: '2026-07-25T00:00:00.000Z',
            contentArtifactRef: 'artifact_comprehensive_start',
            completionStatus: 'complete',
          },
          {
            id: 'message_comprehensive_end',
            role: 'assistant',
            createdAt: '2026-07-25T00:00:30.000Z',
            contentArtifactRef: 'artifact_comprehensive_end',
            completionStatus: 'complete',
          },
          {
            id: 'message_summary',
            role: 'assistant',
            createdAt: '2026-07-25T00:01:00.000Z',
            contentArtifactRef: 'artifact_summary',
            completionStatus: 'complete',
          },
        ]),
      },
    } as unknown as Pick<LocalLearningRuntime, 'access'>;
    const evidence = createReviewEvidence(learning, {
      read: vi.fn(async (artifactId: string) => ({
        artifactId,
        kind: 'message',
        contentSha256: 'd'.repeat(64),
        immutable: true,
        content:
          artifactId === 'artifact_summary'
            ? '# 本课总结\n\n这是课堂总结原文。'
            : artifactId === 'artifact_comprehensive_start'
              ? '综合应用任务：比较资源、组织和时点之间的关系。'
              : '关系收束：先找出会改变结果的瓶颈，再判断当前权力中心。',
      })),
      readDraft: vi.fn().mockResolvedValue(undefined),
    });

    const pack = await evidence.build('final', 'session_1', sourceSnapshotHash);

    expect(pack.classroomSummary).toEqual({
      sourceMessageId: 'message_summary',
      markdown: '# 本课总结\n\n这是课堂总结原文。',
    });
    expect(pack.comprehensiveSynthesis).toEqual({
      sourceMessageId: 'message_comprehensive_end',
      markdown:
        '【综合应用片段 1】\n综合应用任务：比较资源、组织和时点之间的关系。\n\n【综合应用片段 2】\n关系收束：先找出会改变结果的瓶颈，再判断当前权力中心。',
    });
  });
});
