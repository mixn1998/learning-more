import type { TeachingAgentResult } from '../ports/teaching-agent.js';
import type { TeachingContextPackage } from '../ports/teaching-context-sources.js';
import { TeachingDirectiveSchema, normalizeTeachingControlState } from './teaching-directive.js';

export const CONTROL_START = '<learning-more-control>';
export const CONTROL_END = '</learning-more-control>';
export const REPLY_START = '<learning-more-reply>';
export const REPLY_END = '</learning-more-reply>';

function machineControlContext(context: TeachingContextPackage): string {
  const state = normalizeTeachingControlState(context.teachingState);
  const currentUserMessageId = context.recentMessages.findLast(
    (message) => message.role === 'user' && message.completionStatus === 'complete',
  )?.messageId;
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
        depthPreference: existing?.depthPreference ?? 'default',
      };
    }),
    difficultySignals: [],
    ...(context.turnKind === 'opening' || currentUserMessageId === undefined
      ? {}
      : { allowedDifficultySignalSourceMessageId: currentUserMessageId }),
    comprehensiveCheck: state.comprehensiveCheck ?? 'pending',
    closureInquiry: state.closureInquiry ?? 'pending',
    summaryStatus: state.summaryStatus ?? 'pending',
  });
}

export function renderTeachingControlProtocol(context: TeachingContextPackage): string {
  return [
    '【机器控制协议｜不得展示给学习者】',
    '本轮必须严格输出两个区块，可见回复区块在前、控制区块在后：',
    `${REPLY_START}{仅供学习者阅读的 Markdown}${REPLY_END}`,
    `${CONTROL_START}{完整 JSON 教学状态快照}${CONTROL_END}`,
    '必须先完整输出面向学习者的可见回复，再依据本轮实际教学内容生成控制 JSON；控制区块不得夹入可见回复，也不得省略。',
    '控制 JSON 必须包含 schemaVersion=1、lessonPhase、knowledgePoints、difficultySignals、comprehensiveCheck、closureInquiry、summaryStatus；只在 warmup 或 knowledge_point 阶段按需包含 activeKnowledgePointRef。',
    'knowledgePoints 必须完整返回给定的全部 ref；可原样保留用于辨认知识点的 title。每项 status 只能是 pending|learning|completed|skipped，interactionStatus 只能是 pending|completed|skipped，depthPreference 只能是 default|condensed。',
    '只有用户当前原话经语义判断明确表示“不用深入展开、简要带过”或同义意图时，才把对应知识点 depthPreference 设为 condensed；否则保持既有值。若用户之后明确要求深入讲解，可恢复为 default。该字段只调整本次会话教学深度，不改写课程预设重点。',
    'status=completed 表示你已完成该知识点教学，并基于教学互动自主判断可以进入下一阶段；此时 interactionStatus 必须是 completed 或 skipped。',
    'difficultySignals 只上报当前用户原话中与本课具体知识点直接相关的新信号；每项包含 knowledgePointRef、sourceMessageId、kind。kind 只能是 answer_error、misunderstanding、not_understood、request_deeper_explanation。',
    '回答错误、概念误解、明确不理解、直接要求深入讲解分别独立计数；同一条消息可以同时上报不同 kind，但同一 kind 不得重复。延伸拓展、脑洞类或仅相邻探索的问题不得计入。没有新信号时返回空数组。',
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

export function parseTeachingAgentResult(raw: string, structured: boolean): TeachingAgentResult {
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

export function parseInterruptedTeachingMarkdown(raw: string): string {
  return extractBetween(raw, REPLY_START, REPLY_END) ?? '';
}
