import { createHash } from 'node:crypto';

import type { GenerationRuntime } from '../../generation-runtime/interface.js';
import type { GenerationExecution } from '../../generation-runtime/interface.js';
import type { TeachingAgent, TeachingAgentResult } from '../ports/teaching-agent.js';
import type { TeachingContextPackage } from '../ports/teaching-context-sources.js';
import { TeachingDirectiveSchema, normalizeTeachingControlState } from './teaching-directive.js';

const CONTROL_START = '<learning-more-control>';
const CONTROL_END = '</learning-more-control>';
const REPLY_START = '<learning-more-reply>';
const REPLY_END = '</learning-more-reply>';
const STRUCTURED_TASK_PREFIX = 'interactive-teaching-control-v1:';

const TEACHING_CAPABILITY = [
  '依据提供的真实上下文继续当前互动式教学。',
  '课程定义中的知识点顺序是本课教学主线；在当前知识点内，根据学习者最新表达自由决定讲解、提问、案例、教学支线和节奏。',
  '玩法意图只在出现自然教学机会时影响下一步选择，不必每回合显式呈现，也不规定输出形式。',
  '与课程相关但不属于本课的问题属于课程邻接探索：可以自然展开，但不要冒充本课责任已经完成，也不要把未来课节自动记为已学习。',
  '当课程邻接探索正在成为新的主要目标时，把选择权交给学习者：继续探索、暂存后回到本课，或以后补充学习。',
  '对明显与课程无关的请求简短说明并邀请回到相关主题；不要用固定边界模板压制与课程有关的联想。',
  '教学表达保持自由，但一次只承担当前教学阶段：不要重复已经通过或跳过的检测，也不要越过账本一次倾倒后续全部知识点。',
  '不要默认我已经理解，我想要更加深入透彻的学习理解过程体验，更强的思维激活程度和思考密度。',
  '只有当前知识点检测通过或学习者明确选择跳过，并且相关疑问已经处理完，才进入下一知识点。',
  '理解检测与通过判定属于内部教学机制。不要向学习者播报正在检测或已经通过检测，也不要用“恭喜通过”“检测完成”等流程话术。',
  '如果学习者的回答足以支持当前知识点且没有未解决疑问，用一至两句小结当前知识点，承接其刚才的理解并自然进入账本标记的下一知识点。',
  '综合检测通过后也不播报通过状态；先用跨知识点的小结自然过渡，再询问学习者对本课是否还有疑惑或其他讲解需求。',
  '在最终课程总结输出之前，每一轮回复都必须以一个自然、容易回应、与本课有关的问题或表达邀请收束，不能让对话掉在地上。',
  '只有学习者明确表示没有疑问或不需要其他讲解后，才输出最终课程总结；最终课程总结是唯一不再提出问题或引导继续输出的回复。',
  '不要把缺少证据的掌握状态当作事实。可见回复区块只输出学习者可读的 Markdown。',
  '当函数形状、变化、比较、切线、极值、向量场、微分方程相轨迹或空间曲面能明显帮助理解时，可以按需在可见 Markdown 中插入 math-plot 代码块；不必为了展示能力而画图。',
  'math-plot 是声明式 JSON，不得输出 JavaScript。顶层使用 version=1、可选 title/description、view、series 和可选 annotations。',
  'view.type 可为 cartesian2d（xRange/yRange）、polar2d（radialRange/thetaRange）或 cartesian3d（xRange/yRange/zRange）；范围均为 [最小值,最大值]。',
  'series 支持：explicit(expression/domain)、parametric2d(xExpression/yExpression/tRange)、polar(expression/thetaRange)、implicit2d(equation)、points2d(points)、parametric3d(xExpression/yExpression/zExpression/tRange)、surface3d(expression/xDomain/yDomain)、vectorField2d(xExpression/yExpression/density/normalize)、odePhase2d(dxExpression/dyExpression/initialPoints/tRange/step)。',
  '最小示例：```math-plot\n{"version":1,"title":"正弦函数","view":{"type":"cartesian2d","xRange":[-6.28,6.28],"yRange":[-1.5,1.5]},"series":[{"kind":"explicit","expression":"sin(x)","label":"y=sin(x)"}]}\n```',
  '你拥有判断学习者是否足以进入下一教学阶段的教学自主权。判断结果通过隐藏教学指令同步，不要在可见回复中播报检测状态。',
].join('\n');

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function section(title: string, values: readonly string[]): string | undefined {
  const content = values.map((value) => value.trim()).filter((value) => value.length > 0);
  return content.length === 0 ? undefined : `【${title}】\n${content.join('\n')}`;
}

function knowledgeBackground(context: TeachingContextPackage): string[] {
  const state = normalizeTeachingControlState(context.teachingState);
  const textByRef = new Map(
    context.lesson.coreKnowledgePoints.map((point) => [point.ref, point.text] as const),
  );
  return state.knowledgePoints.map((point) => {
    const text = textByRef.get(point.ref) ?? '本课的一个知识责任点';
    const delivery = point.delivery === 'explained' ? '已经讲解过' : '尚未讲解';
    const evidence =
      point.verification === 'supporting'
        ? '学习者表现提供了支持性证据'
        : point.verification === 'limiting'
          ? '仍有需要处理的理解障碍'
          : point.verification === 'mixed'
            ? '现有表现相互混合，尚不能下结论'
            : '尚未观察到足够的学习者证据';
    const progress =
      point.progress === 'completed'
        ? point.interactionStatus === 'skipped'
          ? '该知识点教学已完成，学习者跳过了知识点互动'
          : '该知识点教学已完成'
        : point.progress === 'skipped'
          ? '学习者已跳过该知识点'
          : point.progress === 'learning'
            ? '正在学习中'
            : '待讲解';
    return `- ${text}：${progress}；${delivery}；${evidence}`;
  });
}

function teachingFlowBackground(context: TeachingContextPackage): string[] {
  const state = context.teachingState;
  const phase = state.lessonPhase ?? 'warmup';
  const activePoint = context.lesson.coreKnowledgePoints.find(
    (point) => point.ref === state.activeKnowledgePointRef,
  );
  if (phase === 'warmup') {
    return context.turnKind === 'opening'
      ? [
          '当前阶段是课前热身。主动连接学习目标与已有经验，用一个容易回应的问题了解学习起点。',
          '本回合不展开整课，也不把热身问题写成整套知识检测。',
        ]
      : [
          '学习者正在回答课前热身。先自然回应其学习起点，然后进入账本标记的第一个知识点。',
          `本回合最多完成“${activePoint?.text ?? '第一个知识点'}”的讲解并提出一次理解检测，不要继续倾倒后续知识点。`,
        ];
  }
  if (phase === 'knowledge_point') {
    return [
      `当前只负责知识点：${activePoint?.text ?? '账本标记的当前知识点'}。`,
      '可以自由选择解释、案例、类比、反驳或讨论方式；自然完成讲解后进行理解检测。',
      '如果当前用户原话是在回答检测，就在本回合完成内部判断：通过且没有新疑问时，用简短小结自然引入下一个知识点，不要播报检测或通过状态；未通过时换一种方式继续，不机械重复同一个问题。',
      '如果当前用户原话提出相关疑问，先解决疑问并留在当前知识点；如果用户明确跳过，则尊重选择并进入下一节点。',
    ];
  }
  if (phase === 'comprehensive_check') {
    return [
      '全部知识点教学已经完成或由学习者明确跳过。当前进行跨知识点的综合检测。',
      '若尚未提出综合任务，只提出一个能够连接本课核心关系的任务；若用户正在回答，则完成判断与反馈。',
      '综合回答充分，或用户明确选择跳过时，不播报检测或通过状态；用一小段跨知识点小结自然过渡，然后询问“对本课是否还有疑惑或其他讲解需求”。此时不要输出最终课程总结。',
      '如果综合回答仍不充分，继续提供有针对性的支架，并以一个便于学习者继续表达本课理解的问题收束。',
    ];
  }
  if (phase === 'discussion') {
    return [
      '综合检测已经通过或被学习者明确跳过；当前处于讨论答疑阶段，等待学习者确认是否还有本课疑问或其他讲解需求。',
      '如果学习者提出疑问，完整回应并保持 lessonPhase=discussion、closureInquiry=awaiting_confirmation；在回复末尾再次自然询问是否还有其他疑惑或讲解需求，不要提前输出最终课程总结。',
      '用户可以连续追问任意轮次。只有学习者本轮明确表示没有疑问、不需要继续讲解或可以结束时，才输出结构完整、简洁连贯的最终课程总结，并在同一轮把状态设为 ready_to_close、confirmed_no_questions、delivered。',
    ];
  }
  if (phase === 'summary') {
    return [
      '学习者已经明确表示没有其他疑问。当前只输出本课最终总结，概括核心知识、关系和本次学习形成的关键理解。',
      '总结完成后告知学习者可以结束本课；不要再提出问题、布置任务或开启新的检测循环。',
    ];
  }
  return ['本课教学流程已经完成。简短回应当前诉求，并提示学习者可点击“结束本课”生成最终 Review。'];
}

function currentUserMessage(context: TeachingContextPackage): string {
  return (
    context.recentMessages.findLast(
      (message) => message.role === 'user' && message.completionStatus === 'complete',
    )?.markdown ?? ''
  ).trim();
}

function priorConversation(context: TeachingContextPackage): string[] {
  const visible = context.recentMessages.filter((message) => message.completionStatus !== 'failed');
  const currentIndex = visible.findLastIndex(
    (message) => message.role === 'user' && message.completionStatus === 'complete',
  );
  return visible.slice(0, Math.max(0, currentIndex)).map((message) => {
    const partial = message.completionStatus === 'interrupted' ? '（未完成）' : '';
    return `${message.role === 'user' ? '学习者' : '教学助手'}${partial}：${message.markdown.trim()}`;
  });
}

function machineControlContext(context: TeachingContextPackage): string {
  const state = normalizeTeachingControlState(context.teachingState);
  return JSON.stringify({
    schemaVersion: 1,
    lessonPhase: state.lessonPhase ?? 'warmup',
    ...(state.activeKnowledgePointRef === undefined
      ? {}
      : { activeKnowledgePointRef: state.activeKnowledgePointRef }),
    knowledgePoints: context.lesson.coreKnowledgePoints.map((point) => {
      const existing = state.knowledgePoints.find((candidate) => candidate.ref === point.ref);
      return {
        ref: point.ref,
        title: point.text,
        status: existing?.progress ?? 'pending',
        interactionStatus: existing?.interactionStatus ?? 'pending',
      };
    }),
    comprehensiveCheck: state.comprehensiveCheck ?? 'pending',
    closureInquiry: state.closureInquiry ?? 'pending',
    summaryStatus: state.summaryStatus ?? 'pending',
  });
}

function controlProtocol(context: TeachingContextPackage): string {
  return [
    '【机器控制协议｜不得展示给学习者】',
    '本轮必须严格输出两个区块，控制区块在前、可见回复区块在后：',
    `${CONTROL_START}{完整 JSON 教学状态快照}${CONTROL_END}`,
    `${REPLY_START}{仅供学习者阅读的 Markdown}${REPLY_END}`,
    '控制 JSON 必须包含 schemaVersion=1、lessonPhase、knowledgePoints、comprehensiveCheck、closureInquiry、summaryStatus；只在 warmup 或 knowledge_point 阶段按需包含 activeKnowledgePointRef。',
    'knowledgePoints 必须完整返回给定的全部 ref；可原样保留用于辨认知识点的 title。每项 status 只能是 pending|learning|completed|skipped，interactionStatus 只能是 pending|completed|skipped。',
    'status=completed 表示你已完成该知识点教学，并基于教学互动自主判断可以进入下一阶段；此时 interactionStatus 必须是 completed 或 skipped。',
    '用户跳过整个知识点时使用 status=skipped 且 interactionStatus=skipped；只跳过知识点互动时使用 status=completed 且 interactionStatus=skipped。',
    'comprehensiveCheck 只能是 pending|learning|completed|skipped；用户跳过综合检测时使用 skipped。',
    '已 completed 或 skipped 的节点不得倒退。只有全部知识点 completed/skipped 后才能进入 comprehensive_check；只有综合检测 completed/skipped 后才能进入 discussion。',
    '综合检测 completed 或 skipped 后必须先进入 lessonPhase=discussion、closureInquiry=awaiting_confirmation；讨论答疑期间用户提出任何问题都必须保持该状态并继续答疑。',
    '只有用户在当前轮明确没有其他疑问且最终课程总结已经输出时，才能令 lessonPhase=ready_to_close、closureInquiry=confirmed_no_questions、summaryStatus=delivered。',
    `当前机器状态：${machineControlContext(context)}`,
  ].join('\n');
}

function extractBetween(value: string, start: string, end: string): string | undefined {
  const startIndex = value.indexOf(start);
  if (startIndex === -1) return undefined;
  const contentStart = startIndex + start.length;
  const endIndex = value.indexOf(end, contentStart);
  return value.slice(contentStart, endIndex === -1 ? undefined : endIndex).trim();
}

function parseCompletedResult(raw: string, structured: boolean): TeachingAgentResult {
  const control = extractBetween(raw, CONTROL_START, CONTROL_END);
  const markdown = extractBetween(raw, REPLY_START, REPLY_END);
  if (control === undefined || markdown === undefined) {
    if (structured) throw new Error('teaching_control_protocol_invalid');
    return { markdown: raw };
  }
  const directive = TeachingDirectiveSchema.parse(
    JSON.parse(control) as unknown,
  ) as TeachingAgentResult['directive'];
  if (markdown.length === 0) throw new Error('teaching_reply_empty');
  return { markdown, directive };
}

function parseInterruptedMarkdown(raw: string): string {
  return extractBetween(raw, REPLY_START, REPLY_END) ?? '';
}

export function renderTeachingConversationInput(context: TeachingContextPackage): string {
  const relations = context.course.lessonMap.map(
    (lesson) =>
      `- ${lesson.title}（${lesson.relation === 'current' ? '本课' : lesson.relation === 'prerequisite' ? '前置课' : '相关课'}）：${lesson.objective}`,
  );
  const personalization = context.personalization.signals.map((signal) => {
    const basis =
      signal.explicitness === 'user_declared' ? '学习者曾明确说明' : '历史互动中的弱信号';
    const limitations =
      signal.limitations.length === 0 ? '' : `；使用时注意：${signal.limitations.join('；')}`;
    return `- ${basis}：${signal.summary}${limitations}`;
  });
  const branches = context.teachingState.explorationBranches.map((branch) => {
    const status =
      branch.status === 'active'
        ? '正在探索'
        : branch.status === 'parked'
          ? '已暂存'
          : '已返回主线';
    return `- ${branch.summary}（${status}）`;
  });
  const learnerSignals = context.teachingState.recentLearnerSignals.map((signal) =>
    signal.explicitness === 'user_declared'
      ? `- 学习者明确表达：${signal.summary}`
      : `- 待继续验证的观察：${signal.summary}`,
  );
  const currentRequest = currentUserMessage(context);
  const opening = context.turnKind === 'opening';
  if (!opening && currentRequest.length === 0) throw new Error('current_teaching_request_missing');
  return [
    TEACHING_CAPABILITY,
    '下面是以学习者为中心整理的自然语言背景。它不是要展示给学习者的状态报告或字段清单。',
    opening
      ? '这是学习者刚进入本课的课前热身。请由教学助手主动导入语境，连接学习目标与已有经验，并提出一个容易回应的热身问题。不要要求学习者先提问，不要开始连续讲解全部知识点。'
      : '“当前诉求｜用户原话”是学习者本轮真实输入；其他部分只是已知背景，不要伪装成学习者刚刚说过的话。',
    opening
      ? '直接面向学习者输出自然的开场教学，不复述栏目名或内部状态。'
      : '不要复述栏目名或内部状态，直接回应当前诉求。',
    '',
    `【已知学习背景】\n课程：${context.course.title}\n课程目标：${context.course.goals.join('；')}\n本课：${context.lesson.title}\n本课目标：${context.lesson.objective}`,
    section('课程关系', relations),
    context.course.playIntent === undefined
      ? undefined
      : `【互动关注】\n${context.course.playIntent}`,
    context.learningStartSummary === undefined
      ? undefined
      : `【学习起点】\n${context.learningStartSummary.trim()}`,
    section('当前教学推进', teachingFlowBackground(context)),
    section('本课知识责任与现有证据', knowledgeBackground(context)),
    section(
      '尚待处理的问题',
      context.teachingState.openLoops.map((loop) => `- ${loop.summary}`),
    ),
    section('课程邻接探索', branches),
    section('近期学习者信号', learnerSignals),
    section('可用于个性化的背景', personalization),
    section(
      '相关 Review 摘要',
      context.relevantFinalReviews.map((review) => review.markdown),
    ),
    section(
      '相关学习材料',
      context.readingMaterialExcerpts.map((material) => material.markdown),
    ),
    section('此前真实对话', priorConversation(context)),
    ...(opening ? [] : [`【当前诉求｜用户原话】\n${currentRequest}`]),
    controlProtocol(context),
  ]
    .filter((value): value is string => value !== undefined)
    .join('\n\n');
}

export function createGenerationTeachingAgent(options: {
  runtime: GenerationRuntime;
  execution?: GenerationExecution;
  providerId: string;
}): TeachingAgent {
  async function awaitTerminal(
    taskId: string,
    recover: boolean,
  ): Promise<Awaited<ReturnType<GenerationRuntime['get']>>> {
    if (options.execution !== undefined) {
      return recover ? options.execution.recover(taskId) : options.execution.awaitTerminal(taskId);
    }
    if (recover) await options.runtime.recoverExpiredLeases();
    let task = await options.runtime.get(taskId);
    for (
      let index = 0;
      index < 1_000 && (task.status === 'queued' || task.status === 'running');
      index += 1
    ) {
      const ran = await options.runtime.runNext();
      task = await options.runtime.get(taskId);
      if (ran === undefined && (task.status === 'queued' || task.status === 'running')) {
        throw new Error('teaching_generation_scheduler_stalled');
      }
    }
    return task;
  }

  return {
    async submit(context) {
      const expressionContext = renderTeachingConversationInput(context);
      return (options.execution ?? options.runtime).submit({
        taskKey: `${STRUCTURED_TASK_PREFIX}${context.teachingState.sessionId}:${sha256(expressionContext)}`,
        inputSnapshotHash: sha256(expressionContext),
        taskKind: 'interactive-teaching',
        taskGroup: 'interactive',
        ownerRef: context.teachingState.sessionId,
        providerId: options.providerId,
        priority: 100,
        prompt: expressionContext,
      });
    },
    async complete(taskId) {
      const task = await awaitTerminal(taskId, false);
      if (task.status !== 'completed') throw new Error('teaching_generation_incomplete');
      return parseCompletedResult(
        task.draftMarkdown ?? '',
        task.taskKey.startsWith(STRUCTURED_TASK_PREFIX),
      );
    },
    async read(taskId) {
      const task = await options.runtime.get(taskId);
      if (task.status !== 'completed') return undefined;
      return parseCompletedResult(
        task.draftMarkdown ?? '',
        task.taskKey.startsWith(STRUCTURED_TASK_PREFIX),
      );
    },
    async recover(taskId) {
      const task = await awaitTerminal(taskId, true);
      if (task.status === 'completed') {
        return {
          ...parseCompletedResult(
            task.draftMarkdown ?? '',
            task.taskKey.startsWith(STRUCTURED_TASK_PREFIX),
          ),
          completionStatus: 'complete',
        };
      }
      if (task.status === 'cancelled') {
        return {
          markdown: parseInterruptedMarkdown(task.draftMarkdown ?? ''),
          completionStatus: 'interrupted',
        };
      }
      return {
        completionStatus: 'failed',
        errorCode: task.errorCode ?? `teaching_generation_${task.status}`,
      };
    },
    async stop(taskId) {
      const task = await (options.execution ?? options.runtime).cancel(taskId);
      return {
        markdown: parseInterruptedMarkdown(task.draftMarkdown ?? ''),
        completionStatus: 'interrupted',
      };
    },
  };
}
