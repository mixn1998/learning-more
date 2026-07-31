import type { TeachingContextPackage } from '../ports/teaching-context-sources.js';
import { normalizeTeachingControlState } from './teaching-directive.js';
import { projectTeachingLedger } from './teaching-ledger-projection.js';

const MAX_COURSE_RELATIONS = 3;
const MAX_LOCAL_COURSE_GOALS = 3;
const GENERIC_KNOWLEDGE_RELATIONS = new Set([
  '为下一步理解提供基础',
  '为下一步学习提供基础',
  '为后续理解提供基础',
]);

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
    const evidence =
      point.verification === 'supporting'
        ? '理解证据：支持'
        : point.verification === 'limiting'
          ? '理解证据：受限'
          : point.verification === 'mixed'
            ? '理解证据：混合'
            : undefined;
    const progress =
      point.progress === 'completed'
        ? point.interactionStatus === 'skipped'
          ? '已完成（互动跳过）'
          : '已完成'
        : point.progress === 'skipped'
          ? '已跳过'
          : point.progress === 'learning'
            ? '学习中'
            : '待讲解';
    const markers = [
      definition?.fixedImportance === 'key' ? '重点' : undefined,
      point.adaptiveDifficulty === 'difficult' ? '当前难点' : undefined,
      evidence,
    ].filter((value): value is string => value !== undefined);
    const relation =
      definition?.relationToNext === undefined ||
      GENERIC_KNOWLEDGE_RELATIONS.has(definition.relationToNext.trim())
        ? ''
        : `；与下一节点的关系：${definition.relationToNext}`;
    const attachedBranches =
      definition?.branches === undefined || definition.branches.length === 0
        ? ''
        : `；必要分支：${definition.branches
            .map((branch) => `${branch.content}（${branch.relation}）`)
            .join('；')}`;
    return `- ${text}：${progress}${markers.length === 0 ? '' : `；${markers.join('；')}`}${relation}${attachedBranches}`;
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
  const prior =
    context.turnKind === 'continuation' ? visible : visible.slice(0, Math.max(0, currentIndex));
  return prior.map((message) => {
    const partial = message.completionStatus === 'interrupted' ? '（未完成）' : '';
    return `${message.role === 'user' ? '学习者' : '教学助手'}${partial}：${message.markdown.trim()}`;
  });
}

function recentLearningSignals(context: TeachingContextPackage): string[] {
  const summaries = context.teachingState.recentLearnerSignals
    .map((signal) => signal.summary.trim())
    .filter((summary) => summary.length > 0);
  return [...new Set(summaries)].slice(-4).map((summary) => `- ${summary}`);
}

function priorLearningEvidence(context: TeachingContextPackage): string[] {
  return context.relevantFinalReviews.map(
    (review) => `${review.selectedBecause}\n${review.markdown.trim()}`,
  );
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

function courseRelationLabel(
  relation: TeachingContextPackage['course']['lessonMap'][number]['relation'],
): string {
  if (relation === 'current') return '本课';
  if (relation === 'prerequisite') return '前置课（是否已建立以真实对话为准）';
  if (relation === 'earlier') return '先前课节（是否已建立以真实对话为准）';
  if (relation === 'future') return '后续课（尚未学习，仅用于理解方向）';
  return '相关课（不视为已学习）';
}

function knowledgeMapBackground(context: TeachingContextPackage): string | undefined {
  const map = context.course.knowledgeMap;
  if (map === undefined) return undefined;
  const module = map.currentModule;
  const adjacentModules = [
    module.previousModuleTitle === undefined
      ? undefined
      : `上一模块：${module.previousModuleTitle}`,
    module.nextModuleTitle === undefined ? undefined : `下一模块：${module.nextModuleTitle}`,
  ]
    .filter((value): value is string => value !== undefined)
    .join('；');
  const startingPoint =
    map.isFirstLessonInCourse && map.isFirstLessonInModule
      ? '本课是当前模块的第一课，也是整门课程的第一课。'
      : map.isFirstLessonInModule
        ? '本课是当前模块的第一课，但不是整门课程的第一课。'
        : undefined;
  return [
    '【知识地图位置】',
    `学科或领域：${map.discipline}`,
    `课程位置：第 ${map.courseLessonIndex} 课，共 ${map.courseLessonCount} 课`,
    `当前模块：${module.title}；模块内第 ${module.lessonIndex} 课，共 ${module.lessonCount} 课`,
    startingPoint,
    adjacentModules.length === 0 ? undefined : adjacentModules,
  ]
    .filter((value): value is string => value !== undefined)
    .join('\n');
}

export function renderTeachingFactContext(context: TeachingContextPackage): string {
  const relations = localCourseWindow(context).map(
    (lesson) => `- ${lesson.title}（${courseRelationLabel(lesson.relation)}）：${lesson.objective}`,
  );
  const branches = context.teachingState.explorationBranches.map((branch) => {
    const status =
      branch.status === 'active'
        ? '正在探索'
        : branch.status === 'parked'
          ? '已暂存'
          : '已返回主线';
    return `- ${branch.summary}（${status}）`;
  });
  const currentRequest = currentUserMessage(context);
  const opening = context.turnKind === 'opening';
  const continuation = context.turnKind === 'continuation';
  const discussionContinuation = continuation && context.teachingState.lessonPhase === 'discussion';
  const comprehensiveApplicationContinuation =
    continuation && context.teachingState.lessonPhase === 'comprehensive_application';
  if (!opening && !continuation && currentRequest.length === 0) {
    throw new Error('current_teaching_request_missing');
  }
  return [
    '【教学事实上下文】',
    opening
      ? '开场回合。'
      : continuation
        ? discussionContinuation
          ? '答疑阶段续讲：视为确认无其他疑问；不是理解证据。'
          : comprehensiveApplicationContinuation
            ? '综合应用续讲：视为“直接讲解”；不是学习者作答或理解证据。'
            : '续讲流程事件：沿既有路径继续，不伪造学习者回应或理解证据。'
        : '当前诉求是学习者本轮真实输入；其余内容仅为背景。',
    `【已知学习背景】\n课程：${context.course.title}\n课程目标：${localCourseGoals(context).join('；')}\n本课：${context.lesson.title}\n本课目标：${context.lesson.objective}`,
    knowledgeMapBackground(context),
    section('课程关系', relations),
    section('上一节课学习证据', priorLearningEvidence(context)),
    `【课程关系边界】\n只有真实对话与上一节 Review 核心思想可证明已有理解；课序和标题仅表示知识关系。`,
    context.course.playIntent === undefined
      ? undefined
      : `【互动关注】\n${context.course.playIntent}`,
    context.learningStartSummary === undefined
      ? undefined
      : `【学习起点】\n${context.learningStartSummary.trim()}`,
    section('当前教学窗口', knowledgeBackground(context)),
    section('近期学习信号', recentLearningSignals(context)),
    section(
      '尚待处理的问题',
      context.teachingState.openLoops.map((loop) => `- ${loop.summary}`),
    ),
    section('课程邻接探索', branches),
    section('此前真实对话', priorConversation(context)),
    ...(opening || continuation ? [] : [`【当前诉求｜用户原话】\n${currentRequest}`]),
  ]
    .filter((value): value is string => value !== undefined)
    .join('\n\n');
}
