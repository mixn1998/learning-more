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
    const base = context();
    const opening: TeachingContextPackage = {
      ...base,
      turnKind: 'opening',
      recentMessages: [],
      course: {
        ...base.course,
        goals: ['建立概率推理体系', '连接条件变化与后续推断'],
        knowledgeMap: {
          discipline: '数学',
          courseLessonIndex: 1,
          courseLessonCount: 6,
          currentModule: {
            id: 'module_probability_language',
            title: '模块一：概率语言',
            lessonIndex: 1,
            lessonCount: 2,
            lessons: [
              {
                lessonId: 'lesson_1',
                title: 'Conditioning',
                objective: 'Explain conditioning.',
              },
              {
                lessonId: 'lesson_2',
                title: 'Bayes',
                objective: 'Explain inverse probability.',
              },
            ],
            nextModuleTitle: '模块二：随机变量',
          },
          isFirstLessonInModule: true,
          isFirstLessonInCourse: true,
        },
      },
    };
    const agent = createGenerationTeachingAgent({ runtime: fake.value, providerId: 'mock' });

    await agent.submit(opening, 'opening:session_1');

    expect(fake.request()?.prompt).toContain('本课在当前模块和整门课程中的位置及学习意义');
    expect(fake.request()?.prompt).toContain('最后只提出一个');
    expect(fake.request()?.prompt).toContain('模块一：概率语言');
    expect(fake.request()?.prompt).toContain('本课是当前模块的第一课，也是整门课程的第一课');
    expect(fake.request()?.prompt).toContain('本回复不展开任何知识点，也不推进知识点状态');
    expect(fake.request()?.prompt).toContain('确认版知识链是本课教学边界');
    expect(fake.request()?.prompt).toContain('【当前教学窗口】');
    expect(fake.request()?.prompt).not.toContain('【当前诉求｜用户原话】');
  });

  it('marks future lessons as directional context and ignores placeholder chain edges', async () => {
    const fake = runtime();
    const base = context();
    const agent = createGenerationTeachingAgent({ runtime: fake.value, providerId: 'mock' });

    await agent.submit(
      {
        ...base,
        course: {
          ...base.course,
          lessonMap: [
            ...base.course.lessonMap,
            {
              lessonId: 'lesson_future',
              title: 'Echelon forms and pivots',
              objective: 'Use pivots to read a solution structure.',
              relation: 'future',
            },
          ],
        },
        lesson: {
          ...base.lesson,
          coreKnowledgePoints: [
            {
              ref: 'knowledge:kp_1',
              text: 'Sample-space change.',
              relationToNext: '为下一步理解提供基础',
            },
          ],
        },
      },
      'message_user_future_boundary',
    );

    const prompt = fake.request()?.prompt ?? '';
    expect(prompt).toContain('后续课（尚未学习，仅用于理解方向）');
    expect(prompt).toContain('后续课节标题只表示教学方向，不代表相关术语已经建立');
    expect(prompt).not.toContain('与下一节点的关系：为下一步理解提供基础');
  });

  it('lets the teaching reply prepare the next point without unfolding it or requiring filler text', async () => {
    const fake = runtime();
    const base = context();
    const teachingState = createTeachingState({
      lessonId: 'lesson_1',
      sessionId: 'session_1',
      knowledgePointRefs: ['knowledge:kp_1', 'knowledge:kp_2'],
    });
    const advancingContext: TeachingContextPackage = {
      ...base,
      lesson: {
        ...base.lesson,
        coreKnowledgePoints: [
          { ref: 'knowledge:kp_1', text: 'Political coalition evidence.' },
          { ref: 'knowledge:kp_2', text: 'Path dependence.' },
        ],
      },
      teachingState: {
        ...teachingState,
        lessonPhase: 'knowledge_point',
        activeKnowledgePointRef: 'knowledge:kp_1',
        knowledgePoints: teachingState.knowledgePoints.map((point) =>
          point.ref === 'knowledge:kp_1'
            ? { ...point, progress: 'learning' as const, delivery: 'explained' as const }
            : point,
        ),
      },
      recentMessages: [
        {
          messageId: 'message_current',
          role: 'user',
          completionStatus: 'complete',
          markdown: '军队愿意共同维护这套制度。',
          sourceRef: 'message:message_current',
        },
      ],
    };
    const agent = createGenerationTeachingAgent({ runtime: fake.value, providerId: 'mock' });

    await agent.submit(advancingContext, 'message_user_advance');

    const prompt = fake.request()?.prompt ?? '';
    expect(prompt).toContain('完成后可以把下一主链节点置为 learning，为下一轮准备');
    expect(prompt).toContain('不要在同一可见回复中展开下一节点');
    expect(prompt).toContain('界面会提供“继续讲解”');
    expect(prompt).not.toContain('直接在同一回复中自然衔接并开始下一知识点');
  });

  it('lets the ledger prepare comprehensive application without unfolding it in the same reply', async () => {
    const fake = runtime();
    const base = context();
    const teachingState = createTeachingState({
      lessonId: 'lesson_1',
      sessionId: 'session_1',
      knowledgePointRefs: ['knowledge:kp_1'],
    });
    const agent = createGenerationTeachingAgent({ runtime: fake.value, providerId: 'mock' });

    await agent.submit(
      {
        ...base,
        teachingState: {
          ...teachingState,
          lessonPhase: 'knowledge_point',
          activeKnowledgePointRef: 'knowledge:kp_1',
          knowledgePoints: teachingState.knowledgePoints.map((point) => ({
            ...point,
            progress: 'learning' as const,
            delivery: 'explained' as const,
          })),
        },
      },
      'message_user_last_point',
    );

    const prompt = fake.request()?.prompt ?? '';
    expect(prompt).toContain('最后一个主链节点完成后可以把下一阶段置为 comprehensive_application');
    expect(prompt).toContain('综合应用在下一轮展开');
    expect(prompt).toContain('完成最后一个知识点后可以清除 activeKnowledgePointRef');
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
    expect(fake.request()?.prompt).toContain('无论回应是否正确、是否完整、表示不理解或希望跳过');
    expect(fake.request()?.prompt).toContain('开始讲解“Sample-space change.”');
    expect(fake.request()?.prompt).toContain(
      'Prefer concrete situations when they create a useful learning opportunity.',
    );
    expect(fake.request()?.prompt).toContain('课程邻接探索');
    expect(fake.request()?.prompt).toContain('把选择权交给学习者');
    const prompt = fake.request()?.prompt ?? '';
    expect(prompt).toContain('【教学目标】');
    expect(prompt).toContain('以学习者形成清晰、准确、能够支撑后续理解的知识结构为最高目标');
    expect(prompt).toContain('自主选择此刻最有教学价值的教学动作');
    expect(prompt).toContain('讲解深度、表达方式、互动形式和衔接范围由你判断');
    expect(prompt).toContain('优先以精确定义建立共同基准');
    expect(prompt).toContain('各独立语义条件共同如何充分刻画目标');
    expect(prompt).toContain('删减、放宽或替换条件后的反例');
    expect(prompt).toContain('不要求套用固定段落或逐项盘问');
    expect(prompt).toContain('当前结论如何产生新的问题');
    expect(prompt).toContain('下一概念为什么由此成为必要');
    expect(prompt).toContain('尚未学习的后续内容不能作为当前论证的未解释前提');
    expect(prompt).toContain('先判断缺失的是定义、判据、概念边界还是中间推理');
    expect(prompt).toContain('只有学习者参与会为后续教学带来真实信息或思考价值时才发起互动');
    expect(prompt).not.toContain('语言表达、叙事节奏和互动方式应随课程大纲的目标');
    expect(prompt.match(/【教学目标】/gu)).toHaveLength(1);
    expect(prompt.indexOf('【教学目标】')).toBeLessThan(prompt.indexOf('【通用教学原则】'));
    expect(prompt).toContain('【当前教学阶段】');
    expect(prompt).not.toContain('本回合只处理');
    expect(fake.request()?.prompt).toContain('综合应用只提供一次');
    expect(fake.request()?.prompt).toContain('只有学习者明确没有疑问或无需继续讲解后');
    expect(prompt).not.toContain('学习者已经实质回应互动或明确跳过互动');
    expect(prompt).not.toContain('首次完整讲解并发出互动邀请时必须');
    expect(prompt).not.toContain('形成可回应的互动');
    expect(prompt).not.toContain('学习者回应或明确跳过');
    expect(prompt).not.toContain('下一教学动作已经明确时直接行动');
    expect(prompt).not.toContain('情境应用、对比辨析、错误诊断');
    expect(prompt).not.toContain('同一理解缺口最多追问一次');
    expect(prompt).not.toContain('每轮都以自然、易回应');
    expect(prompt).not.toContain('用一至两句小结');
    expect(fake.request()?.prompt).not.toContain('```math-plot');
    expect(fake.request()?.prompt).not.toContain('vectorField2d');
    expect(fake.request()?.reasoningEffort).toBe('low');
    expect(fake.request()?.prompt).toContain('<learning-more-control>');
    expect(fake.request()?.prompt).toContain('控制 JSON 使用 schemaVersion=3');
    expect(fake.request()?.prompt).toContain('每轮必须返回 turnHandoff');
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
    expect(fake.request()?.prompt).toContain('如果学习者提出疑问，继续答疑');
    expect(fake.request()?.prompt).not.toContain('在回复末尾');
    expect(fake.request()?.prompt).toContain('在学习者确认无需继续前，不要输出最终课程总结');
    expect(fake.request()?.prompt).toContain('用户可以连续追问任意轮次');
    expect(fake.request()?.prompt).toContain('才输出最终课程总结');
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
  it('keeps the transfer purpose without prescribing a task form', () => {
    const base = context();
    const prompt = renderTeachingFlowPolicy({
      ...base,
      teachingState: {
        ...base.teachingState,
        lessonPhase: 'comprehensive_application',
        comprehensiveCheck: 'learning',
      },
    });

    expect(prompt).toContain('综合应用应连接本课核心知识关系并体现迁移');
    expect(prompt).not.toContain('任务形式和反馈方式');
    expect(prompt).not.toContain('新情境决策、反例诊断、条件变化预测');
    expect(prompt).not.toContain('不要沿用课堂原题的对象、数字、叙述骨架和问法');
  });
});
