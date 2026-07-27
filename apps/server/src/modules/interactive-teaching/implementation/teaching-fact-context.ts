import type { TeachingContextPackage } from '../ports/teaching-context-sources.js';
import { normalizeTeachingControlState } from './teaching-directive.js';
import { projectTeachingLedger } from './teaching-ledger-projection.js';
import { renderTeachingPersonalizationPrompt } from './teaching-personalization-prompt.js';

const MAX_COURSE_RELATIONS = 8;
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
        ? '存在需要处理的理解缺口'
        : point.progress === 'pending'
          ? '教学责任尚未完成'
          : '当前无新增阻塞';
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
    return `- ${text}：${progress}；${weight}；${difficulty}；${delivery}；${evidence}；${need}${relation}${attachedBranches}`;
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
  if (context.course.knowledgeMap !== undefined) return context.course.goals;
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
  const moduleLessons = module.lessons
    .map(
      (lesson, index) =>
        `${index + 1}. ${lesson.title}${lesson.lessonId === context.lesson.lessonId ? '（本课）' : ''}：${lesson.objective}`,
    )
    .join('\n');
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
    `模块内课节：\n${moduleLessons}`,
  ]
    .filter((value): value is string => value !== undefined)
    .join('\n');
}

export function renderTeachingFactContext(context: TeachingContextPackage): string {
  const relations = localCourseWindow(context).map(
    (lesson) => `- ${lesson.title}（${courseRelationLabel(lesson.relation)}）：${lesson.objective}`,
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
  const currentRequest = currentUserMessage(context);
  const opening = context.turnKind === 'opening';
  const continuation = context.turnKind === 'continuation';
  if (!opening && !continuation && currentRequest.length === 0) {
    throw new Error('current_teaching_request_missing');
  }
  return [
    '【教学事实上下文】',
    opening
      ? '这是学习者刚进入本课的课前热身。'
      : continuation
        ? '这是学习者点击“继续讲解”触发的系统续讲事件；它不是学习者消息、理解证据或互动回应。'
        : '“当前诉求｜用户原话”是学习者本轮真实输入；其他部分只是已知背景，不要伪装成学习者刚刚说过的话。',
    `【已知学习背景】\n课程：${context.course.title}\n课程目标：${localCourseGoals(context).join('；')}\n本课：${context.lesson.title}\n本课目标：${context.lesson.objective}`,
    knowledgeMapBackground(context),
    section('课程关系', relations),
    `【课程关系使用边界】\n实际发生的对话决定哪些概念已经建立。前置、先前、相关和后续课节标题只描述知识关系；尤其后续课节标题只表示教学方向，不代表相关术语已经建立。`,
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
    section('可用于个性化的背景', personalization),
    section('此前真实对话', priorConversation(context)),
    ...(opening || continuation ? [] : [`【当前诉求｜用户原话】\n${currentRequest}`]),
  ]
    .filter((value): value is string => value !== undefined)
    .join('\n\n');
}
