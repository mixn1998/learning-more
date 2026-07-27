import type { GenerationRequest, GenerationRuntime } from '../../generation-runtime/interface.js';
import type { GenerationTask } from '../../generation-runtime/ports/generation-task-repository.js';
import { describe, expect, it } from 'vitest';

import { createGenerationReviewWriter } from '../implementation/generation-review-writer.js';

describe('GenerationReviewWriter', () => {
  it('uses semantic core insight instead of overriding it with local text filtering', async () => {
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
            methodologyInsight:
              '先确认当前约束改变了哪些可行路径，再比较不同路径会把结果推向哪里。',
            coreInsight: [
              '- 条件表达式产生 True 或 False，决定程序进入哪条路径。',
              '- if / elif / else 从上到下判断，只执行第一个命中的分支。',
            ].join('\n'),
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
      async listByOwner() {
        return [];
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
        classroomSummary: {
          sourceMessageId: 'message_ai_1',
          markdown: [
            '本课学习完成。',
            '',
            '- 条件表达式产生 True 或 False，决定程序进入哪条路径。',
            '- if / elif / else 从上到下判断，只执行第一个命中的分支。',
            '你在运费综合应用中正确跟踪了原程序，并通过调整条件顺序处理了无效输入、重叠条件和边界值。',
          ].join('\n'),
        },
        comprehensiveSynthesis: {
          sourceMessageId: 'message_ai_1',
          markdown:
            '你没有直接回答综合应用。把关系合起来看：先确认约束改变了哪些可行路径，再比较结果。',
        },
        reviewLens: '自然关注情境信息使用、约束意识和迁移边界。',
      },
      'initial',
    );

    await expect(writer.complete(accepted.taskId)).resolves.toMatchObject({
      markdown: '',
      lessonFinalAnalysis: {
        kind: 'lesson-final',
        schemaVersion: 1,
        coreInsight: [
          '- 条件表达式产生 True 或 False，决定程序进入哪条路径。',
          '- if / elif / else 从上到下判断，只执行第一个命中的分支。',
        ].join('\n'),
      },
    });
    expect(request?.prompt).toContain('【本课责任】');
    expect(request?.prompt).toContain('【必要的学习者原话证据】');
    expect(request?.prompt).toContain('课程邻接探索');
    expect(request?.prompt).toContain('没有实际邻接探索时省略该模块');
    expect(request?.prompt).toContain('knowledgeMap 只负责把本课知识点串成关系图式');
    expect(request?.prompt).toContain('coreInsight 必须返回');
    expect(request?.prompt).toContain('methodologyInsight');
    expect(request?.prompt).toContain('本课学习完成。');
    expect(request?.prompt).toContain('你在运费综合应用中正确跟踪了原程序');
    expect(request?.prompt).toContain('你没有直接回答综合应用');
    expect(request?.prompt).toContain('用户没有直接回答或明确跳过综合应用');
    expect(request?.prompt).toContain('不得据此声称用户已经掌握');
    expect(request?.prompt).toMatch(/完成宣布、用户评价、掌握判断.*未来学习建议.*不属于核心思想/u);
    expect(request?.prompt).toContain('理解最终课堂总结，识别其中承担知识表达的有效语义');
    expect(request?.prompt).toContain('动态保留完成理解所必需的总结结构');
    expect(request?.prompt).toContain('不得套用固定框架');
    expect(request?.prompt).toContain('仅以【最终课堂总结·仅供语义收束】中的知识性内容为来源');
    expect(request?.prompt).toContain('有效知识内容允许原样保留，不要求改写');
    expect(request?.prompt).toContain('对承担知识表达的部分，保留其原有措辞、顺序和结构');
    expect(request?.prompt).not.toContain('不得直接复制整段课堂文本');
    expect(request?.prompt).not.toContain('而不是截取或轻度改写原文');
    expect(request?.prompt).toContain('保留承载语义的 Markdown 格式');
    expect(request?.prompt).toContain('加粗、分段、编号层级、列表、引用块、代码或公式');
    expect(request?.prompt).toContain('不得为了简短而删除');
    expect(request?.prompt).not.toContain('只保留能改变理解或行动的最小充分表达');
    expect(request?.prompt).toContain('performance 在后端继续完整记录');
    expect(request?.prompt).toContain('用户可见 markdown 必须统一使用第二人称“你”');
    expect(request?.prompt).toContain('每个条目必须是语义完整的表达');
    expect(request?.prompt).toContain('自然关注情境信息使用、约束意识和迁移边界。');
    expect(request?.prompt).not.toContain('observationCompleteness');
    expect(request?.prompt).not.toContain('checkpoint_1');
    expect(request?.prompt).toContain('[E1]');
    expect(request?.prompt).not.toContain('message:message_user_1');
    expect(request?.prompt).not.toContain('The denominator follows');
    expect(request?.prompt).not.toContain('sourceSnapshotHash');
    expect(request?.prompt).not.toContain('reviewLens');
    expect(request?.prompt).toContain('"kind":"lesson-final"');
    expect(request?.prompt).not.toContain('templateRef');
    expect(request?.prompt).not.toMatch(/玩法专属章节|必须按/u);
  });

  it('accepts semantic distillation fields in the final Review contract', async () => {
    const task: GenerationTask = {
      id: 'task_review_semantic',
      taskKey: 'review-semantic',
      status: 'completed',
      createdAt: '2026-07-25T00:00:00.000Z',
      updatedAt: '2026-07-25T00:00:00.000Z',
      resourceVersion: 0,
      taskKind: 'final-review',
      draftMarkdown: JSON.stringify({
        schemaVersion: 1,
        kind: 'lesson-final',
        title: '本课 Review',
        knowledgeMap: { title: '知识图谱', markdown: '约束 → 路径 → 结果' },
        methodologyInsight: '先识别约束改变了哪些路径，再判断结果如何变化。',
        coreInsight: '本课建立了约束、行动路径与结果之间的关系。',
        performance: [{ title: '已形成', markdown: '能够识别关键约束。' }],
      }),
    };
    const runtime = {
      async get() {
        return task;
      },
      async runNext() {
        return task.id;
      },
    } as unknown as GenerationRuntime;
    const writer = createGenerationReviewWriter({ runtime, providerId: 'mock' });

    await expect(writer.complete(task.id)).resolves.toMatchObject({
      lessonFinalAnalysis: {
        coreInsight: '本课建立了约束、行动路径与结果之间的关系。',
        methodologyInsight: '先识别约束改变了哪些路径，再判断结果如何变化。',
      },
    });
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
