import type { GenerationRequest, GenerationRuntime } from '../../generation-runtime/interface.js';
import type { GenerationTask } from '../../generation-runtime/ports/generation-task-repository.js';
import { describe, expect, it } from 'vitest';

import { createGenerationTeachingAgent } from '../implementation/generation-teaching-agent.js';
import { createTeachingState } from '../implementation/teaching-state-reducer.js';
import type { TeachingContextPackage } from '../ports/teaching-context-sources.js';

function context(): TeachingContextPackage {
  return {
    schemaVersion: 1,
    course: {
      courseId: 'course_1',
      outlineVersionId: 'outline_1',
      title: 'Probability',
      courseMode: 'case_study',
      playIntent: 'Prefer concrete situations when they create a useful learning opportunity.',
      goals: ['Understand probability.'],
      lessonMap: [
        {
          lessonId: 'lesson_1',
          title: 'Conditioning',
          objective: 'Explain conditioning.',
          relation: 'current',
        },
      ],
    },
    lesson: {
      lessonId: 'lesson_1',
      outlineVersionId: 'outline_1',
      title: 'Conditioning',
      objective: 'Explain conditioning.',
      coreKnowledgePoints: [{ ref: 'knowledge:kp_1', text: 'Sample-space change.' }],
    },
    relevantFinalReviews: [],
    readingMaterialExcerpts: [],
    personalization: {
      profileVersion: 0,
      purpose: 'interactive_teaching',
      courseId: 'course_1',
      lessonId: 'lesson_1',
      signals: [],
      completeness: 'insufficient',
      sourceSnapshotHash: '0'.repeat(64),
      createdAt: '2026-07-14T00:00:00.000Z',
    },
    teachingState: createTeachingState({
      lessonId: 'lesson_1',
      sessionId: 'session_1',
      knowledgePointRefs: ['knowledge:kp_1'],
    }),
    recentMessages: [
      {
        messageId: 'message_current',
        role: 'user',
        completionStatus: 'complete',
        markdown: 'Explain this systematically.',
        sourceRef: 'message:message_current',
      },
    ],
    unobservedMessages: [],
  };
}

function runtime(options: { includeKnowledgePointTitles?: boolean } = {}) {
  const directive = {
    schemaVersion: 1,
    lessonPhase: 'warmup',
    activeKnowledgePointRef: 'knowledge:kp_1',
    knowledgePoints: [{ ref: 'knowledge:kp_1', status: 'pending', interactionStatus: 'pending' }],
    comprehensiveCheck: 'pending',
    closureInquiry: 'pending',
    summaryStatus: 'pending',
  } as const;
  let request: GenerationRequest | undefined;
  let task: GenerationTask = {
    id: 'task_1',
    taskKey: 'pending',
    status: 'queued',
    createdAt: '2026-07-14T00:00:00.000Z',
    updatedAt: '2026-07-14T00:00:00.000Z',
    resourceVersion: 0,
  };
  const value: GenerationRuntime = {
    async submit(input) {
      request = input;
      task = { ...task, taskKey: input.taskKey };
      return { taskId: task.id };
    },
    async runNext() {
      const emittedDirective = options.includeKnowledgePointTitles
        ? {
            ...directive,
            knowledgePoints: directive.knowledgePoints.map((point) => ({
              ...point,
              title: 'Sample-space change.',
            })),
          }
        : directive;
      task = {
        ...task,
        status: 'completed',
        draftMarkdown: `<learning-more-control>${JSON.stringify(emittedDirective)}</learning-more-control><learning-more-reply>A free-form explanation.</learning-more-reply>`,
      };
      return task.id;
    },
    async cancel() {
      task = {
        ...task,
        status: 'cancelled',
        draftMarkdown:
          '<learning-more-control>{}</learning-more-control><learning-more-reply>A partial explanation.',
      };
      return task;
    },
    async get() {
      return task;
    },
    async recoverExpiredLeases() {
      return 0;
    },
    async getMetrics() {
      return { total: 1, byStatus: { [task.status]: 1 }, byErrorCode: {} };
    },
  };
  return { value, request: () => request, directive };
}

describe('GenerationTeachingAgent', () => {
  it('renders an active opening instruction without a fabricated learner request', async () => {
    const fake = runtime();
    const opening = { ...context(), turnKind: 'opening' as const, recentMessages: [] };
    const agent = createGenerationTeachingAgent({ runtime: fake.value, providerId: 'mock' });

    await agent.submit(opening);

    expect(fake.request()?.prompt).toContain('主动导入语境');
    expect(fake.request()?.prompt).toContain('当前阶段是课前热身');
    expect(fake.request()?.prompt).toContain('不要开始连续讲解全部知识点');
    expect(fake.request()?.prompt).toContain('【本课知识责任与现有证据】');
    expect(fake.request()?.prompt).not.toContain('【当前诉求｜用户原话】');
  });

  it('submits materialized context with one stable capability contract and no scene template', async () => {
    const fake = runtime();
    const agent = createGenerationTeachingAgent({
      runtime: fake.value,
      providerId: 'mock',
    });

    const accepted = await agent.submit(context());

    expect(accepted.taskId).toBe('task_1');
    expect(fake.request()?.taskKind).toBe('interactive-teaching');
    expect(fake.request()?.prompt).toContain('Explain this systematically.');
    expect(fake.request()?.prompt).not.toContain('lesson-response@v1');
    expect(fake.request()?.prompt).not.toContain('templateRef');
    expect(fake.request()?.prompt).not.toContain('modeWeight');
    expect(fake.request()?.prompt).toContain('【已知学习背景】');
    expect(fake.request()?.prompt).toContain('【当前诉求｜用户原话】');
    expect(fake.request()?.prompt).toContain('学习者正在回答课前热身');
    expect(fake.request()?.prompt).toContain('本回合最多完成“Sample-space change.”');
    expect(fake.request()?.prompt).toContain(
      'Prefer concrete situations when they create a useful learning opportunity.',
    );
    expect(fake.request()?.prompt).toContain('课程邻接探索');
    expect(fake.request()?.prompt).toContain('把选择权交给学习者');
    expect(fake.request()?.prompt).toContain(
      '不要默认我已经理解，我想要更加深入透彻的学习理解过程体验，更强的思维激活程度和思考密度。',
    );
    expect(fake.request()?.prompt).toContain('不要向学习者播报正在检测或已经通过检测');
    expect(fake.request()?.prompt).toContain('用一至两句小结当前知识点');
    expect(fake.request()?.prompt).toContain('综合检测通过后也不播报通过状态');
    expect(fake.request()?.prompt).toContain('是否还有疑惑或其他讲解需求');
    expect(fake.request()?.prompt).toContain('每一轮回复都必须以一个自然、容易回应');
    expect(fake.request()?.prompt).toContain('最终课程总结是唯一不再提出问题');
    expect(fake.request()?.prompt).toContain('```math-plot');
    expect(fake.request()?.prompt).toContain('vectorField2d');
    expect(fake.request()?.prompt).toContain('odePhase2d');
    expect(fake.request()?.prompt).toContain('不得输出 JavaScript');
    expect(fake.request()?.prompt).toContain('<learning-more-control>');
    expect(fake.request()?.prompt).toContain('interactionStatus');
    expect(fake.request()?.prompt).toContain('difficultySignals');
    expect(fake.request()?.prompt).toContain('answer_error');
    expect(fake.request()?.prompt).toContain('延伸拓展、脑洞类或仅相邻探索的问题不得计入');
    expect(fake.request()?.prompt).toContain(
      '"allowedDifficultySignalSourceMessageId":"message_current"',
    );
    expect(fake.request()?.prompt).toContain('knowledge:kp_1');
    expect(fake.request()?.prompt).not.toContain('TeachingScopeEnvelope');
    expect(fake.request()?.prompt).not.toContain('off_scope');
    expect(fake.request()?.prompt?.match(/Explain this systematically\./gu)).toHaveLength(1);
    for (const internalValue of [
      'courseId',
      'lessonId',
      'outlineVersionId',
      'courseMode',
      'playIntent',
      'teachingState',
      'sourceSnapshotHash',
      'session_1',
    ]) {
      expect(fake.request()?.prompt).not.toContain(internalValue);
    }
    await expect(agent.complete('task_1')).resolves.toEqual({
      markdown: 'A free-form explanation.',
      directive: fake.directive,
    });
  });

  it('accepts the knowledge-point titles included in the supplied machine state', async () => {
    const fake = runtime({ includeKnowledgePointTitles: true });
    const agent = createGenerationTeachingAgent({ runtime: fake.value, providerId: 'mock' });

    await agent.submit(context());

    await expect(agent.complete('task_1')).resolves.toEqual({
      markdown: 'A free-form explanation.',
      directive: fake.directive,
    });
  });

  it('requires explicit no-further-questions confirmation before the final summary', async () => {
    const fake = runtime();
    const base = context();
    const summaryContext: TeachingContextPackage = {
      ...base,
      teachingState: {
        ...base.teachingState,
        lessonPhase: 'discussion',
        comprehensiveCheck: 'skipped',
        closureInquiry: 'awaiting_confirmation',
      },
      recentMessages: [
        {
          messageId: 'message_current',
          role: 'user',
          completionStatus: 'complete',
          markdown: '这个概念能再解释一下吗？',
          sourceRef: 'message:message_current',
        },
      ],
    };
    const agent = createGenerationTeachingAgent({ runtime: fake.value, providerId: 'mock' });

    await agent.submit(summaryContext);

    expect(fake.request()?.prompt).toContain('当前处于讨论答疑阶段');
    expect(fake.request()?.prompt).toContain('如果学习者提出疑问，完整回应');
    expect(fake.request()?.prompt).toContain('在回复末尾再次自然询问是否还有其他疑惑或讲解需求');
    expect(fake.request()?.prompt).toContain('不要提前输出最终课程总结');
    expect(fake.request()?.prompt).toContain('用户可以连续追问任意轮次');
    expect(fake.request()?.prompt).toContain('才输出结构完整、简洁连贯的最终课程总结');
  });

  it('preserves interrupted Markdown without treating it as a complete reply', async () => {
    const fake = runtime();
    const agent = createGenerationTeachingAgent({ runtime: fake.value, providerId: 'mock' });
    await agent.submit(context());

    await expect(agent.stop('task_1')).resolves.toEqual({
      markdown: 'A partial explanation.',
      completionStatus: 'interrupted',
    });
  });

  it('recovers persisted completed, interrupted, and failed generation outcomes', async () => {
    const fake = runtime();
    const agent = createGenerationTeachingAgent({ runtime: fake.value, providerId: 'mock' });
    await agent.submit(context());
    await fake.value.runNext();

    await expect(agent.recover('task_1')).resolves.toEqual({
      markdown: 'A free-form explanation.',
      directive: fake.directive,
      completionStatus: 'complete',
    });
    await expect(agent.read('task_1')).resolves.toEqual({
      markdown: 'A free-form explanation.',
      directive: fake.directive,
    });

    await fake.value.cancel('task_1');
    await expect(agent.recover('task_1')).resolves.toEqual({
      markdown: 'A partial explanation.',
      completionStatus: 'interrupted',
    });
  });
});
