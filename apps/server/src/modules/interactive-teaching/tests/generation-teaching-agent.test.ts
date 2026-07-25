import type { GenerationRequest, GenerationRuntime } from '../../generation-runtime/interface.js';

type GenerationTask = Awaited<ReturnType<GenerationRuntime['get']>>;
import { describe, expect, it } from 'vitest';

import { createGenerationTeachingAgent } from '../implementation/generation-teaching-agent.js';
import { createTeachingState } from '../implementation/teaching-state-reducer.js';
import { renderTeachingFlowPolicy } from '../implementation/teaching-flow-policy.js';
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

function runtime(
  options: {
    includeKnowledgePointTitles?: boolean;
    streamChunks?: readonly string[];
    emitStalePrefixSnapshot?: boolean;
    transientRunningReadFailures?: number;
    waitForCancellation?: boolean;
  } = {},
) {
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
  let transientRunningReadFailures = options.transientRunningReadFailures ?? 0;
  let getCount = 0;
  const subscribers = new Set<(task: GenerationTask) => void>();
  let releaseRunNext: (() => void) | undefined;
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
      if (options.waitForCancellation === true) {
        task = { ...task, status: 'running', draftMarkdown: '' };
        for (const subscriber of subscribers) subscriber(task);
        await new Promise<void>((resolve) => {
          releaseRunNext = resolve;
        });
        return task.id;
      }
      const emittedDirective = options.includeKnowledgePointTitles
        ? {
            ...directive,
            knowledgePoints: directive.knowledgePoints.map((point) => ({
              ...point,
              title: 'Sample-space change.',
            })),
          }
        : directive;
      const completeMarkdown = `<learning-more-reply>A free-form explanation. A second sentence.</learning-more-reply><learning-more-control>${JSON.stringify(emittedDirective)}</learning-more-control>`;
      if (options.streamChunks !== undefined) {
        task = { ...task, status: 'running', draftMarkdown: '' };
        for (const subscriber of subscribers) subscriber(task);
        let previousSnapshot: GenerationTask | undefined;
        for (const chunk of options.streamChunks) {
          await new Promise((resolve) => setTimeout(resolve, 70));
          previousSnapshot = task;
          task = { ...task, draftMarkdown: `${task.draftMarkdown ?? ''}${chunk}` };
          for (const subscriber of subscribers) subscriber(task);
          if (
            options.emitStalePrefixSnapshot === true &&
            previousSnapshot.draftMarkdown !== task.draftMarkdown
          ) {
            for (const subscriber of subscribers) subscriber(previousSnapshot);
          }
        }
      }
      task = {
        ...task,
        status: 'completed',
        draftMarkdown: options.streamChunks === undefined ? completeMarkdown : task.draftMarkdown,
      };
      for (const subscriber of subscribers) subscriber(task);
      return task.id;
    },
    async cancel() {
      task = {
        ...task,
        status: 'cancelled',
        draftMarkdown: '<learning-more-reply>A partial explanation.',
      };
      for (const subscriber of subscribers) subscriber(task);
      releaseRunNext?.();
      return task;
    },
    async get() {
      getCount += 1;
      if (task.status === 'running' && transientRunningReadFailures > 0) {
        transientRunningReadFailures -= 1;
        throw Object.assign(new Error('GENERATION_TASK_NOT_FOUND'), {
          code: 'GENERATION_TASK_NOT_FOUND',
        });
      }
      return task;
    },
    async listByOwner() {
      return [];
    },
    async recoverExpiredLeases() {
      return 0;
    },
    async getMetrics() {
      return { total: 1, byStatus: { [task.status]: 1 }, byErrorCode: {} };
    },
    subscribe(_taskId, observer) {
      subscribers.add(observer);
      return () => subscribers.delete(observer);
    },
  };
  return { value, request: () => request, directive, getCount: () => getCount };
}

describe('GenerationTeachingAgent', () => {
  it('bounds course-wide and personalization context around the current lesson', async () => {
    const fake = runtime();
    const base = context();
    const bounded: TeachingContextPackage = {
      ...base,
      course: {
        ...base.course,
        goals: Array.from({ length: 12 }, (_, index) => `goal-${index}`),
        lessonMap: Array.from({ length: 12 }, (_, index) => ({
          lessonId: index === 6 ? base.lesson.lessonId : `other_lesson_${index}`,
          title: `lesson-title-${index}`,
          objective: `lesson-objective-${index}`,
          relation: index === 6 ? ('current' as const) : ('other' as const),
        })),
      },
      personalization: {
        ...base.personalization,
        signals: Array.from({ length: 12 }, (_, index) => ({
          evidenceId: `evidence_${index}`,
          summary: `personalization-signal-${index}`,
          explicitness: 'ai_observed' as const,
          sourceRefs: [`message:${index}`],
          limitations: [],
        })),
      },
    };
    const agent = createGenerationTeachingAgent({ runtime: fake.value, providerId: 'mock' });

    await agent.submit(bounded, 'message_user_bounded');

    const prompt = fake.request()?.prompt ?? '';
    expect(prompt).toContain('goal-5；goal-6；goal-7');
    expect(prompt).not.toContain('goal-0');
    expect(prompt).toContain('lesson-title-3');
    expect(prompt).toContain('lesson-title-10');
    expect(prompt).not.toContain('lesson-title-11');
    expect(prompt).toContain('personalization-signal-7');
    expect(prompt).toContain('只读压缩投影');
  });

  it('renders an active opening instruction without a fabricated learner request', async () => {
    const fake = runtime();
    const opening = { ...context(), turnKind: 'opening' as const, recentMessages: [] };
    const agent = createGenerationTeachingAgent({ runtime: fake.value, providerId: 'mock' });

    await agent.submit(opening, 'opening:session_1');

    expect(fake.request()?.prompt).toContain('主动导入语境');
    expect(fake.request()?.prompt).toContain('当前阶段是课前热身');
    expect(fake.request()?.prompt).toContain('不要开始连续讲解全部知识点');
    expect(fake.request()?.prompt).toContain('【当前教学窗口】');
    expect(fake.request()?.prompt).not.toContain('【当前诉求｜用户原话】');
  });

  it('submits materialized context with one stable capability contract and no scene template', async () => {
    const fake = runtime();
    const agent = createGenerationTeachingAgent({
      runtime: fake.value,
      providerId: 'mock',
    });

    const accepted = await agent.submit(context(), 'message_user_1');

    expect(accepted.taskId).toBe('task_1');
    expect(fake.request()?.taskKind).toBe('interactive-teaching');
    expect(fake.request()?.requestRef).toBe('message_user_1');
    expect(fake.request()?.prompt).toContain('Explain this systematically.');
    expect(fake.request()?.prompt).not.toContain('lesson-response@v1');
    expect(fake.request()?.prompt).not.toContain('templateRef');
    expect(fake.request()?.prompt).not.toContain('modeWeight');
    expect(fake.request()?.prompt).toContain('【已知学习背景】');
    expect(fake.request()?.prompt).toContain('【当前诉求｜用户原话】');
    expect(fake.request()?.prompt).toContain('学习者正在回应课前热身');
    expect(fake.request()?.prompt).toContain('本回合最多完成“Sample-space change.”');
    expect(fake.request()?.prompt).toContain(
      'Prefer concrete situations when they create a useful learning opportunity.',
    );
    expect(fake.request()?.prompt).toContain('课程邻接探索');
    expect(fake.request()?.prompt).toContain('把选择权交给学习者');
    expect(fake.request()?.prompt).toContain(
      '不要默认用户理解，但也不要用频繁过密的互动中断教学推进',
    );
    const prompt = fake.request()?.prompt ?? '';
    expect(prompt).toContain('【教学方针（高优先级）】');
    expect(prompt).toContain(
      '以开放、可回应且服务于理解推进的互动教学为核心，不预设任何阅读理解式的标准答案（严禁设计阅读理解式的课堂互动）。',
    );
    expect(prompt).toContain('可以邀请学习者思考，但不强制其沿预设步骤');
    expect(prompt).toContain('优先沿其思考路径继续教学');
    expect(prompt).toContain(
      '下一教学动作已经明确时，不要用“接下来看看”“下一步将讲”“也可以先”之类的话预告或列出分支',
    );
    expect(prompt).toContain('直接进入下一段讲解、示例或互动');
    expect(prompt).toContain('语言表达、叙事节奏和互动方式应随课程大纲的目标');
    expect(prompt.match(/【教学方针（高优先级）】/gu)).toHaveLength(1);
    expect(prompt.indexOf('【教学方针（高优先级）】')).toBeLessThan(
      prompt.indexOf('【通用教学原则】'),
    );
    expect(prompt).not.toContain(
      '严谨应服务于理解推进；纠偏后沿知识逻辑自然前进，避免反复盘问相似细节。',
    );
    expect(fake.request()?.prompt).toContain('知识点提问是非强制互动邀请');
    expect(fake.request()?.prompt).toContain('不得在同一轮直接完成');
    expect(fake.request()?.prompt).toContain('综合应用只提供一次');
    expect(fake.request()?.prompt).toContain('只有学习者明确没有疑问或无需继续讲解后');
    expect(fake.request()?.prompt).toContain('互动邀请不要求机械复述');
    expect(fake.request()?.prompt).toContain('情境应用、对比辨析、错误诊断');
    expect(fake.request()?.prompt).toContain('同一理解缺口最多追问一次');
    expect(fake.request()?.prompt).toContain('推动理解继续向前深化');
    expect(fake.request()?.prompt).toContain('每轮都以自然、易回应');
    expect((fake.request()?.prompt ?? '').indexOf('互动邀请不要求机械复述')).toBeLessThan(
      (fake.request()?.prompt ?? '').indexOf('每轮都以自然、易回应'),
    );
    expect(fake.request()?.prompt).toContain('该总结是唯一不再提问');
    expect(fake.request()?.prompt).not.toContain('```math-plot');
    expect(fake.request()?.prompt).not.toContain('vectorField2d');
    expect(fake.request()?.reasoningEffort).toBe('low');
    expect(fake.request()?.prompt).toContain('<learning-more-control>');
    expect(fake.request()?.prompt).toContain('控制 JSON 使用 schemaVersion=2');
    expect(fake.request()?.prompt).toContain('lessonPhase 每轮必须返回');
    expect(fake.request()?.prompt).toContain(
      'warmup|knowledge_point|comprehensive_application|discussion|summary|ready_to_close',
    );
    expect(fake.request()?.prompt).toContain('knowledgePoints 仅列变化项');
    expect(fake.request()?.prompt).toContain('interactionStatus');
    expect(fake.request()?.prompt).toContain('difficultySignals');
    expect(fake.request()?.prompt).not.toContain('verificationSignals');
    expect(fake.request()?.prompt).not.toContain('连续两次回答正确');
    expect(fake.request()?.prompt).toContain('answer_error');
    expect(fake.request()?.prompt).toContain('延伸、脑洞或相邻探索不计');
    expect(fake.request()?.prompt).toContain('"allowedDifficultySignalSourceMessageId":"U1"');
    expect(fake.request()?.prompt).toContain('"comprehensiveApplication":"pending"');
    expect(fake.request()?.prompt).toContain('"ref":"K1"');
    expect(fake.request()?.prompt).not.toContain('knowledge:kp_1');
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
      markdown: 'A free-form explanation. A second sentence.',
      directive: fake.directive,
    });
  });

  it('injects the math capability and raises effort only when the turn needs them', async () => {
    const fake = runtime();
    const base = context();
    const agent = createGenerationTeachingAgent({ runtime: fake.value, providerId: 'mock' });

    await agent.submit(
      {
        ...base,
        teachingState: {
          ...base.teachingState,
          lessonPhase: 'knowledge_point',
          activeKnowledgePointRef: 'knowledge:kp_1',
        },
        lesson: {
          ...base.lesson,
          objective: '理解函数图像与坐标变化',
          coreKnowledgePoints: [
            { ref: 'knowledge:kp_1', text: '函数图像', fixedImportance: 'key' },
          ],
        },
        recentMessages: [
          {
            messageId: 'message_current',
            role: 'user',
            completionStatus: 'complete',
            markdown: '能画图解释为什么会这样吗？',
            sourceRef: 'message:message_current',
          },
        ],
      },
      'message_user_visual',
    );

    expect(fake.request()?.prompt).toContain('```math-plot');
    expect(fake.request()?.prompt).toContain('vectorField2d');
    expect(fake.request()?.reasoningEffort).toBe('medium');
  });

  it('accepts the knowledge-point titles included in the supplied machine state', async () => {
    const fake = runtime({ includeKnowledgePointTitles: true });
    const agent = createGenerationTeachingAgent({ runtime: fake.value, providerId: 'mock' });

    await agent.submit(context(), 'message_user_1');

    await expect(agent.complete('task_1')).resolves.toEqual({
      markdown: 'A free-form explanation. A second sentence.',
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

    await agent.submit(summaryContext, 'message_user_1');

    expect(fake.request()?.prompt).toContain('当前处于讨论答疑阶段');
    expect(fake.request()?.prompt).toContain('如果学习者提出疑问，完整回应');
    expect(fake.request()?.prompt).toContain('在回复末尾再次自然询问是否还有其他疑惑或讲解需求');
    expect(fake.request()?.prompt).toContain('不要提前输出最终课程总结');
    expect(fake.request()?.prompt).toContain('用户可以连续追问任意轮次');
    expect(fake.request()?.prompt).toContain('才输出结构完整、简洁连贯的最终课程总结');
  });

  it('publishes validated reply sentences while provider output is still arriving', async () => {
    const control = `<learning-more-control>${JSON.stringify(runtime().directive)}</learning-more-control>`;
    const chunks = [
      '<learning-more-reply>A free-form explanation.',
      ' ',
      `A second sentence.</learning-more-reply>${control}`,
    ];
    const fake = runtime({ streamChunks: chunks });
    const agent = createGenerationTeachingAgent({ runtime: fake.value, providerId: 'mock' });
    await agent.submit(context(), 'message_user_1');
    const observed: string[] = [];

    await expect(
      agent.complete('task_1', {
        onDirective() {
          observed.push('directive');
        },
        onReplyCompleted() {
          observed.push('reply-completed');
        },
        onReplyDelta(markdown) {
          observed.push(markdown);
        },
      }),
    ).resolves.toEqual({
      markdown: 'A free-form explanation. A second sentence.',
      directive: fake.directive,
    });
    expect(observed).toEqual([
      'A free-form explanation.',
      ' A second sentence.',
      'reply-completed',
      'directive',
    ]);
    expect(fake.getCount()).toBeLessThanOrEqual(3);
  });

  it('ignores stale prefix snapshots delivered after newer streaming snapshots', async () => {
    const control = `<learning-more-control>${JSON.stringify(runtime().directive)}</learning-more-control>`;
    const fake = runtime({
      streamChunks: [
        '<learning-more-reply>A durable streamed reply.',
        ` A second sentence.</learning-more-reply>${control}`,
      ],
      emitStalePrefixSnapshot: true,
    });
    const agent = createGenerationTeachingAgent({ runtime: fake.value, providerId: 'mock' });
    await agent.submit(context(), 'message_user_stale_snapshot');
    const observed: string[] = [];

    await expect(
      agent.complete('task_1', {
        onReplyDelta(markdown) {
          observed.push(markdown);
        },
      }),
    ).resolves.toMatchObject({
      markdown: 'A durable streamed reply. A second sentence.',
    });
    expect(observed.join('')).toBe('A durable streamed reply. A second sentence.');
  });

  it('treats a transient missing task projection as in-flight instead of failed', async () => {
    const control = `<learning-more-control>${JSON.stringify(runtime().directive)}</learning-more-control>`;
    const fake = runtime({
      streamChunks: [
        '<learning-more-reply>A durable streamed reply.</learning-more-reply>',
        control,
      ],
      transientRunningReadFailures: 3,
    });
    const agent = createGenerationTeachingAgent({ runtime: fake.value, providerId: 'mock' });
    await agent.submit(context(), 'message_user_1');
    const observed: string[] = [];

    await expect(
      agent.complete('task_1', {
        onReplyDelta(markdown) {
          observed.push(markdown);
        },
      }),
    ).resolves.toMatchObject({ markdown: 'A durable streamed reply.' });
    expect(observed.join('')).toBe('A durable streamed reply.');
  });

  it('reports a closed visible reply before rejecting a missing control block', async () => {
    const fake = runtime({
      streamChunks: ['<learning-more-reply>A complete teaching answer.</learning-more-reply>'],
    });
    const agent = createGenerationTeachingAgent({ runtime: fake.value, providerId: 'mock' });
    await agent.submit(context(), 'message_user_1');
    const observed: string[] = [];

    await expect(
      agent.complete('task_1', {
        onReplyDelta(markdown) {
          observed.push(markdown);
        },
        onReplyCompleted(markdown) {
          observed.push(`completed:${markdown}`);
        },
      }),
    ).rejects.toThrow('teaching_control_protocol_invalid');
    expect(observed).toEqual([
      'A complete teaching answer.',
      'completed:A complete teaching answer.',
    ]);
  });

  it('preserves interrupted Markdown without treating it as a complete reply', async () => {
    const fake = runtime();
    const agent = createGenerationTeachingAgent({ runtime: fake.value, providerId: 'mock' });
    await agent.submit(context(), 'message_user_1');

    await expect(agent.stop('task_1')).resolves.toEqual({
      markdown: 'A partial explanation.',
      completionStatus: 'interrupted',
    });
  });

  it('recovers persisted completed, interrupted, and failed generation outcomes', async () => {
    const fake = runtime();
    const agent = createGenerationTeachingAgent({ runtime: fake.value, providerId: 'mock' });
    await agent.submit(context(), 'message_user_1');
    await fake.value.runNext();

    await expect(agent.recover('task_1')).resolves.toEqual({
      markdown: 'A free-form explanation. A second sentence.',
      directive: fake.directive,
      completionStatus: 'complete',
    });
    await expect(agent.read('task_1')).resolves.toEqual({
      markdown: 'A free-form explanation. A second sentence.',
      directive: fake.directive,
    });

    await fake.value.cancel('task_1');
    await expect(agent.recover('task_1')).resolves.toEqual({
      markdown: 'A partial explanation.',
      completionStatus: 'interrupted',
    });
  });

  it('cancels a generation that is waiting without another stream update', async () => {
    const fake = runtime({ waitForCancellation: true });
    const agent = createGenerationTeachingAgent({ runtime: fake.value, providerId: 'mock' });
    const accepted = await agent.submit(context(), 'message_user_abort');
    const controller = new AbortController();

    const completing = agent.complete(accepted.taskId, undefined, controller.signal);
    await new Promise<void>((resolve) => setImmediate(resolve));
    controller.abort();

    await expect(completing).rejects.toThrow('teaching_generation_cancelled');
    await expect(fake.value.get(accepted.taskId)).resolves.toMatchObject({ status: 'cancelled' });
  });
});

describe('comprehensive check variety', () => {
  it('requires a transfer task instead of paraphrasing classroom checks', () => {
    const base = context();
    const prompt = renderTeachingFlowPolicy({
      ...base,
      teachingState: {
        ...base.teachingState,
        lessonPhase: 'comprehensive_application',
        comprehensiveCheck: 'learning',
      },
    });

    expect(prompt).toContain('综合应用要连接本课全部核心知识点');
    expect(prompt).toContain('不要沿用课堂原题的对象、数字、叙述骨架和问法');
  });
});
