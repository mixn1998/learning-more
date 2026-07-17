import type { GenerationRequest, GenerationRuntime } from '../../generation-runtime/interface.js';
import type { GenerationTask } from '../../generation-runtime/ports/generation-task-repository.js';
import { describe, expect, it } from 'vitest';

import { createGenerationReviewWriter } from '../implementation/generation-review-writer.js';

describe('GenerationReviewWriter', () => {
  it('uses the complete checkpoint as mandatory evidence and keeps the play lens advisory', async () => {
    let request: GenerationRequest | undefined;
    let task: GenerationTask = {
      id: 'task_review',
      taskKey: 'review',
      status: 'queued',
      createdAt: '2026-07-14T00:00:00.000Z',
      updatedAt: '2026-07-14T00:00:00.000Z',
      resourceVersion: 0,
      taskKind: 'final-review',
    };
    const runtime: GenerationRuntime = {
      async submit(input) {
        request = input;
        return { taskId: task.id };
      },
      async runNext() {
        task = {
          ...task,
          status: 'completed',
          draftMarkdown: JSON.stringify({
            schemaVersion: 1,
            kind: 'lesson-final',
            title: '本课总结：条件概率的参照系',
            knowledgeMap: {
              title: '条件改变参照总体',
              markdown: '样本空间 → 条件事件 → 新的分母',
              evidenceRefs: ['message:message_user_1'],
            },
            coreInsight: '分母变化不是技巧，而是参照总体已经改变。',
            performance: [
              { title: '你做得很好的地方', markdown: '主动追问了分母为什么变化。' },
              { title: '接下来的判断', markdown: '继续检验不同条件下参照总体的变化。' },
            ],
          }),
        };
        return task.id;
      },
      async get() {
        return task;
      },
      async cancel() {
        return task;
      },
      async recoverExpiredLeases() {
        return 0;
      },
      async getMetrics() {
        return { total: 1, byStatus: { completed: 1 }, byErrorCode: {} };
      },
    };
    const writer = createGenerationReviewWriter({ runtime, providerId: 'mock' });
    const accepted = await writer.submit(
      {
        kind: 'final',
        checkpoint: {
          checkpointId: 'checkpoint_1',
          reason: 'lesson_closure',
          lessonId: 'lesson_1',
          sessionId: 'session_1',
          teachingState: {
            schemaVersion: 1,
            lessonId: 'lesson_1',
            sessionId: 'session_1',
            ledgerVersion: 1,
            observedThroughMessageId: 'message_ai_1',
            sourceSnapshotHash: 'a'.repeat(64),
            observationStatus: 'current',
            scopeStatus: 'needs_return',
            evidenceCheckpoint: true,
            knowledgePoints: [],
            openLoops: [],
            explorationBranches: [
              {
                entryId: 'branch_1',
                summary: 'An adjacent exploration.',
                courseTopicRefs: ['course-topic:later'],
                sourceRefs: ['message:message_user_1'],
                returnAnchorRefs: ['lesson:lesson_1'],
                status: 'active',
              },
            ],
            recentLearnerSignals: [],
          },
          observationRefs: ['observation:observation_1'],
          sourceMessageIds: ['message_user_1', 'message_ai_1'],
          sourceSnapshotHash: 'a'.repeat(64),
          observationCompleteness: 'complete',
          retentionDecision: 'preserve',
          frozenAt: '2026-07-14T00:02:00.000Z',
        },
        course: { courseId: 'course_1', title: 'Probability' },
        lesson: {
          lessonId: 'lesson_1',
          title: 'Conditioning',
          objective: 'Understand conditioning.',
          coreKnowledgePoints: ['Conditioning changes the reference population.'],
        },
        observations: [
          {
            observationId: 'observation_1',
            schemaVersion: 1,
            lessonId: 'lesson_1',
            sessionId: 'session_1',
            turnSequence: 1,
            sourceMessageIds: ['message_user_1', 'message_ai_1'],
            sourceSnapshotHash: 'a'.repeat(64),
            scope: {
              alignment: 'adjacent',
              relationRefs: ['course-topic:later'],
              rationale: 'A course-adjacent branch.',
            },
            entries: [],
            observerVersion: 'teaching-observer@1',
            observedAt: '2026-07-14T00:01:00.000Z',
            status: 'active',
          },
        ],
        messages: [
          {
            messageId: 'message_user_1',
            role: 'user',
            completionStatus: 'complete',
            markdown: 'Why does the denominator change?',
            sourceRef: 'message:message_user_1',
          },
          {
            messageId: 'message_ai_1',
            role: 'assistant',
            completionStatus: 'complete',
            markdown: 'The denominator follows the current reference population.',
            sourceRef: 'message:message_ai_1',
          },
        ],
        reviewLens: '自然关注情境信息使用、约束意识和迁移边界。',
      },
      'initial',
    );

    await expect(writer.complete(accepted.taskId)).resolves.toMatchObject({
      markdown: expect.stringContaining('条件概率的参照系'),
      document: { kind: 'lesson-final', schemaVersion: 1 },
    });
    expect(request?.prompt).toContain('【本课责任】');
    expect(request?.prompt).toContain('【必要的学习者原话证据】');
    expect(request?.prompt).toContain('课程邻接探索');
    expect(request?.prompt).toContain('自然关注情境信息使用、约束意识和迁移边界。');
    expect(request?.prompt).not.toContain('observationCompleteness');
    expect(request?.prompt).not.toContain('checkpoint_1');
    expect(request?.prompt).toContain('message:message_user_1');
    expect(request?.prompt).not.toContain('The denominator follows');
    expect(request?.prompt).not.toContain('sourceSnapshotHash');
    expect(request?.prompt).not.toContain('reviewLens');
    expect(request?.prompt).toContain('"kind":"lesson-final"');
    expect(request?.prompt).not.toContain('templateRef');
    expect(request?.prompt).not.toMatch(/玩法专属章节|必须按/u);
  });

  it('refuses to generate from an incomplete checkpoint', async () => {
    const runtime = {} as GenerationRuntime;
    const writer = createGenerationReviewWriter({ runtime, providerId: 'mock' });
    await expect(
      writer.submit(
        {
          kind: 'stage',
          checkpoint: {
            checkpointId: 'checkpoint_pending',
            reason: 'manual_pause',
            lessonId: 'lesson_1',
            sessionId: 'session_1',
            teachingState: {
              schemaVersion: 1,
              lessonId: 'lesson_1',
              sessionId: 'session_1',
              ledgerVersion: 0,
              sourceSnapshotHash: 'a'.repeat(64),
              observationStatus: 'pending',
              scopeStatus: 'aligned',
              evidenceCheckpoint: false,
              knowledgePoints: [],
              openLoops: [],
              explorationBranches: [],
              recentLearnerSignals: [],
            },
            observationRefs: [],
            sourceMessageIds: ['message_1'],
            sourceSnapshotHash: 'a'.repeat(64),
            observationCompleteness: 'pending',
            retentionDecision: 'preserve',
            frozenAt: '2026-07-14T00:00:00.000Z',
          },
          course: { courseId: 'course_1', title: 'Course' },
          lesson: {
            lessonId: 'lesson_1',
            title: 'Lesson',
            objective: 'Objective',
            coreKnowledgePoints: [],
          },
          observations: [],
          messages: [],
        },
        'initial',
      ),
    ).rejects.toThrow('review_checkpoint_incomplete');
  });

  it('generates the course Review from materialized lesson evidence without a fixed template', async () => {
    let request: GenerationRequest | undefined;
    const runtime = {
      async submit(input: GenerationRequest) {
        request = input;
        return { taskId: 'task_course_review' };
      },
    } as GenerationRuntime;
    const writer = createGenerationReviewWriter({ runtime, providerId: 'mock' });

    await expect(
      writer.submitCourse(
        {
          kind: 'course',
          course: {
            courseId: 'course_1',
            title: 'Probability',
            outlineVersionId: 'outline_1',
          },
          lessons: [
            {
              lessonId: 'lesson_1',
              title: 'Conditioning',
              objective: 'Understand conditioning.',
              coreKnowledgePoints: ['Reference population'],
            },
          ],
          lessonReviews: [
            {
              lessonId: 'lesson_1',
              kind: 'final',
              sourceRef: 'artifact:review_1',
              markdown: 'The learner explained the denominator change.',
            },
          ],
          abandonedWithoutReviewLessonIds: [],
          reviewLens: '自然关注情境中的判断。',
        },
        'initial',
      ),
    ).resolves.toEqual({ taskId: 'task_course_review' });
    expect(request?.prompt).toContain('【课程结构】');
    expect(request?.prompt).toContain('【已有课时 Review】');
    expect(request?.prompt).toContain('The learner explained the denominator change.');
    expect(request?.prompt).toContain('自然关注情境中的判断。');
    expect(request?.prompt).not.toContain('lessonReviews');
    expect(request?.prompt).not.toContain('outline_1');
    expect(request?.prompt).not.toContain('artifact:review_1');
    expect(request?.prompt).not.toContain('reviewLens');
    expect(request?.prompt).not.toContain('course-review@v1');
    expect(request?.prompt).not.toContain('templateRef');
  });
});
