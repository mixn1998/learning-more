import { createHash } from 'node:crypto';

import type { GenerationRuntime } from '../../generation-runtime/interface.js';
import type { GenerationExecution } from '../../generation-runtime/interface.js';
import type { TeachingAgent } from '../ports/teaching-agent.js';
import type { TeachingContextPackage } from '../ports/teaching-context-sources.js';

const TEACHING_CAPABILITY = [
  '依据提供的真实上下文继续当前互动式教学。',
  '课程定义中的知识点顺序是本课教学主线；在当前知识点内，根据学习者最新表达自由决定讲解、提问、案例、教学支线和节奏。',
  '玩法意图只在出现自然教学机会时影响下一步选择，不必每回合显式呈现，也不规定输出形式。',
  '与课程相关但不属于本课的问题属于课程邻接探索：可以自然展开，但不要冒充本课责任已经完成，也不要把未来课节自动记为已学习。',
  '当课程邻接探索正在成为新的主要目标时，把选择权交给学习者：继续探索、暂存后回到本课，或以后补充学习。',
  '对明显与课程无关的请求简短说明并邀请回到相关主题；不要用固定边界模板压制与课程有关的联想。',
  '教学表达保持自由，但一次只承担当前教学阶段：不要重复已经通过或跳过的检测，也不要越过账本一次倾倒后续全部知识点。',
  '只有当前知识点检测通过或学习者明确选择跳过，并且相关疑问已经处理完，才进入下一知识点。',
  '不要把缺少证据的掌握状态当作事实。只输出学习者可见的 Markdown。',
].join('\n');

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function section(title: string, values: readonly string[]): string | undefined {
  const content = values.map((value) => value.trim()).filter((value) => value.length > 0);
  return content.length === 0 ? undefined : `【${title}】\n${content.join('\n')}`;
}

function knowledgeBackground(context: TeachingContextPackage): string[] {
  const textByRef = new Map(
    context.lesson.coreKnowledgePoints.map((point) => [point.ref, point.text] as const),
  );
  return context.teachingState.knowledgePoints.map((point) => {
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
      point.progress === 'passed'
        ? '本课检测已通过'
        : point.progress === 'skipped'
          ? '学习者已选择跳过'
          : point.progress === 'checking'
            ? '正在讲解或检测'
            : point.progress === 'teaching'
              ? '正在讲解'
              : '尚未进入';
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
      '如果当前用户原话是在回答检测，就在本回合判断并反馈：通过且没有新疑问时可自然引入下一个知识点；未通过时换一种方式继续，不机械重复同一个问题。',
      '如果当前用户原话提出相关疑问，先解决疑问并留在当前知识点；如果用户明确跳过，则尊重选择并进入下一节点。',
    ];
  }
  if (phase === 'comprehensive_check') {
    return [
      '全部知识点已经逐项通过或由学习者明确跳过。当前进行跨知识点的综合检测。',
      '若尚未提出综合任务，只提出一个能够连接本课核心关系的任务；若用户正在回答，则完成判断与反馈。',
      '综合回答通过或用户明确跳过且没有其他疑问时，直接进入本课总结；否则处理疑问或补充检测。',
    ];
  }
  if (phase === 'summary') {
    return [
      '综合检测已经通过或被学习者明确跳过。当前由教学助手总结本课知识点及其关系。',
      '总结完成后告知学习者可以结束本课，不再开启新的检测循环。',
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
        taskKey: `interactive-teaching:${context.teachingState.sessionId}:${sha256(expressionContext)}`,
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
      return { markdown: task.draftMarkdown ?? '' };
    },
    async recover(taskId) {
      const task = await awaitTerminal(taskId, true);
      if (task.status === 'completed') {
        return { markdown: task.draftMarkdown ?? '', completionStatus: 'complete' };
      }
      if (task.status === 'cancelled') {
        return { markdown: task.draftMarkdown ?? '', completionStatus: 'interrupted' };
      }
      return {
        completionStatus: 'failed',
        errorCode: task.errorCode ?? `teaching_generation_${task.status}`,
      };
    },
    async stop(taskId) {
      const task = await (options.execution ?? options.runtime).cancel(taskId);
      return {
        markdown: task.draftMarkdown ?? '',
        completionStatus: 'interrupted',
      };
    },
  };
}
