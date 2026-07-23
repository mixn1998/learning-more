import type { TeachingContextPackage } from '../ports/teaching-context-sources.js';
import { normalizeTeachingControlState } from './teaching-directive.js';
import { projectTeachingLedger } from './teaching-ledger-projection.js';
import { renderTeachingPersonalizationPrompt } from './teaching-personalization-prompt.js';

const MAX_COURSE_RELATIONS = 8;
const MAX_LOCAL_COURSE_GOALS = 3;
const MAX_RELEVANT_REVIEWS = 3;
const MAX_READING_EXCERPTS = 4;

function section(title: string, values: readonly string[]): string | undefined {
  const content = values.map((value) => value.trim()).filter((value) => value.length > 0);
  return content.length === 0 ? undefined : `【${title}】\n${content.join('\n')}`;
}

function knowledgeBackground(context: TeachingContextPackage): string[] {
  const state = normalizeTeachingControlState(context.teachingState);
  const projection = projectTeachingLedger(context);
  const textByRef = new Map(
    context.lesson.coreKnowledgePoints.map((point) => [point.ref, point.text] as const),
  );
  return projection.knowledgePoints.map((projected) => {
    const point = state.knowledgePoints.find((candidate) => candidate.ref === projected.ref);
    if (point === undefined) return `- ${projected.title}：待讲解`;
    const text = textByRef.get(point.ref) ?? '本课的一个知识责任点';
    const definition = context.lesson.coreKnowledgePoints.find(
      (candidate) => candidate.ref === point.ref,
    );
    const weight =
      definition?.fixedImportance === 'key' ? '固定教学权重：重点' : '固定教学权重：普通';
    const difficulty = point.adaptiveDifficulty === 'difficult' ? '会话难点：是' : '会话难点：否';
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
    const need =
      point.verification === 'limiting' || point.verification === 'mixed'
        ? '本轮需要针对现有理解缺口继续支架'
        : point.progress === 'pending'
          ? '按本课顺序建立理解并形成可回应的互动'
          : '依据当前证据自然推进';
    return `- ${text}：${progress}；${weight}；${difficulty}；${delivery}；${evidence}；教学需要：${need}`;
  });
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

function localCourseWindow(context: TeachingContextPackage) {
  const currentIndex = context.course.lessonMap.findIndex(
    (lesson) => lesson.relation === 'current' || lesson.lessonId === context.lesson.lessonId,
  );
  if (currentIndex < 0) return context.course.lessonMap.slice(0, MAX_COURSE_RELATIONS);
  const start = Math.max(0, currentIndex - Math.floor((MAX_COURSE_RELATIONS - 1) / 2));
  return context.course.lessonMap.slice(start, start + MAX_COURSE_RELATIONS);
}

function localCourseGoals(context: TeachingContextPackage): readonly string[] {
  const currentIndex = context.course.lessonMap.findIndex(
    (lesson) => lesson.relation === 'current' || lesson.lessonId === context.lesson.lessonId,
  );
  if (currentIndex < 0) return context.course.goals.slice(0, MAX_LOCAL_COURSE_GOALS);
  const start = Math.max(0, currentIndex - 1);
  return context.course.goals.slice(start, start + MAX_LOCAL_COURSE_GOALS);
}

export function renderTeachingFactContext(context: TeachingContextPackage): string {
  const relations = localCourseWindow(context).map(
    (lesson) =>
      `- ${lesson.title}（${lesson.relation === 'current' ? '本课' : lesson.relation === 'prerequisite' ? '前置课' : '相关课'}）：${lesson.objective}`,
  );
  const personalization = renderTeachingPersonalizationPrompt(context.personalization);
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
    '【教学事实上下文】',
    opening
      ? '这是学习者刚进入本课的课前热身。'
      : '“当前诉求｜用户原话”是学习者本轮真实输入；其他部分只是已知背景，不要伪装成学习者刚刚说过的话。',
    `【已知学习背景】\n课程：${context.course.title}\n课程目标：${localCourseGoals(context).join('；')}\n本课：${context.lesson.title}\n本课目标：${context.lesson.objective}`,
    section('课程关系', relations),
    context.course.playIntent === undefined
      ? undefined
      : `【互动关注】\n${context.course.playIntent}`,
    context.learningStartSummary === undefined
      ? undefined
      : `【学习起点】\n${context.learningStartSummary.trim()}`,
    section('当前教学窗口', knowledgeBackground(context)),
    section(
      '尚待处理的问题',
      context.teachingState.openLoops.map((loop) => `- ${loop.summary}`),
    ),
    section('课程邻接探索', branches),
    section('近期学习者信号', learnerSignals),
    section('可用于个性化的背景', personalization),
    section(
      '相关 Review 摘要',
      context.relevantFinalReviews.slice(0, MAX_RELEVANT_REVIEWS).map((review) => review.markdown),
    ),
    section(
      '相关学习材料',
      context.readingMaterialExcerpts
        .slice(0, MAX_READING_EXCERPTS)
        .map((material) => material.markdown),
    ),
    section('此前真实对话', priorConversation(context)),
    ...(opening ? [] : [`【当前诉求｜用户原话】\n${currentRequest}`]),
  ]
    .filter((value): value is string => value !== undefined)
    .join('\n\n');
}
