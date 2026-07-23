import type { TeachingAgentResult } from '../ports/teaching-agent.js';
import type { TeachingContextPackage } from '../ports/teaching-context-sources.js';
import { TeachingDirectiveSchema } from './teaching-directive.js';
import { projectTeachingLedger } from './teaching-ledger-projection.js';

export const CONTROL_START = '<learning-more-control>';
export const CONTROL_END = '</learning-more-control>';
export const REPLY_START = '<learning-more-reply>';
export const REPLY_END = '</learning-more-reply>';

export function normalizeTerminalTeachingControl(raw: string): string {
  if (raw.includes(CONTROL_END)) return raw;
  const controlStart = raw.indexOf(CONTROL_START);
  if (controlStart < 0) return raw;
  const repeatedStart = raw.indexOf(CONTROL_START, controlStart + CONTROL_START.length);
  if (repeatedStart < 0) return raw;
  if (raw.slice(repeatedStart + CONTROL_START.length).trim().length > 0) return raw;
  if (raw.indexOf(CONTROL_START, repeatedStart + CONTROL_START.length) >= 0) return raw;
  return `${raw.slice(0, repeatedStart)}${CONTROL_END}${raw.slice(
    repeatedStart + CONTROL_START.length,
  )}`;
}

function machineControlContext(context: TeachingContextPackage): string {
  const projection = projectTeachingLedger(context);
  const currentUserMessageId = context.recentMessages.findLast(
    (message) => message.role === 'user' && message.completionStatus === 'complete',
  )?.messageId;
  return JSON.stringify({
    schemaVersion: 1,
    lessonPhase: projection.lessonPhase,
    projectionMode: projection.mode,
    ...(projection.activeKnowledgePointRef === undefined
      ? {}
      : { activeKnowledgePointRef: projection.activeKnowledgePointRef }),
    knowledgePoints: projection.knowledgePoints.map((point) => ({
      ref: point.ref,
      title: point.title,
      status: point.status,
      interactionStatus: point.interactionStatus,
      depthPreference: point.depthPreference,
      deepFollowUpCount: point.deepFollowUpCount,
      ...(point.verificationStreak === undefined
        ? {}
        : { verificationStreak: point.verificationStreak }),
    })),
    ...(projection.nextKnowledgePoint === undefined
      ? {}
      : { nextKnowledgePoint: projection.nextKnowledgePoint }),
    progress: {
      completedOrSkipped: projection.completedOrSkippedCount,
      total: projection.totalKnowledgePointCount,
      allTerminal: projection.allKnowledgePointsTerminal,
    },
    difficultySignals: [],
    verificationSignals: [],
    ...(context.turnKind === 'opening' || currentUserMessageId === undefined
      ? {}
      : {
          allowedDifficultySignalSourceMessageId: currentUserMessageId,
          allowedVerificationSignalSourceMessageId: currentUserMessageId,
        }),
    comprehensiveCheck: projection.comprehensiveCheck,
    closureInquiry: projection.closureInquiry,
    summaryStatus: projection.summaryStatus,
  });
}

export function renderTeachingControlProtocol(context: TeachingContextPackage): string {
  return [
    '【机器控制协议｜不得展示给学习者】',
    '严格输出两个区块：先给学习者可见回复，再给隐藏控制 JSON：',
    `${REPLY_START}{仅供学习者阅读的 Markdown}${REPLY_END}`,
    `${CONTROL_START}{schemaVersion=2 的稀疏 JSON 教学状态变更}${CONTROL_END}`,
    '可见回复必须完整且不得混入控制内容。控制 JSON 使用 schemaVersion=2，只返回本轮变化；其余状态由服务端权威账本补齐。',
    'lessonPhase 每轮必须返回，且只能是 warmup|knowledge_point|comprehensive_check|discussion|summary|ready_to_close；即使阶段未变化也必须返回当前值。',
    'knowledgePoints 仅列变化项，每项含 ref 及发生变化的 status、interactionStatus、depthPreference；无变化则省略。difficultySignals 同理。',
    'activeKnowledgePointRef 仅在发生变化时返回；需要清除当前知识点时明确返回 null。status 只能是 pending|learning|completed|skipped，interactionStatus 只能是 pending|completed|skipped，depthPreference 只能是 default|condensed。',
    '仅当用户当前原话明确要求简要带过时，才将对应 depthPreference 设为 condensed；之后明确要求深入可恢复 default。它只影响本会话教学深度，不改课程预设重点。',
    'status=completed 表示你已完成该知识点教学，并基于教学互动自主判断可以进入下一阶段；此时 interactionStatus 必须是 completed 或 skipped。',
    'difficultySignals 只上报当前用户原话对具体知识点产生的新信号，每项含 knowledgePointRef、sourceMessageId、kind；kind∈answer_error|misunderstanding|not_understood|request_deeper_explanation。',
    '四类信号独立计数；同一消息可上报不同 kind、不可重复同一 kind。延伸、脑洞或相邻探索不计；无新信号时省略。',
    '用户跳过整个知识点时使用 status=skipped 且 interactionStatus=skipped；只跳过知识点互动时使用 status=completed 且 interactionStatus=skipped。',
    'comprehensiveCheck∈pending|learning|completed|skipped；跳过检测用 skipped。节点终态不得倒退；全部知识点终态后才能进入 comprehensive_check，检测终态后才能进入 discussion。',
    '综合检测 completed 或 skipped 后必须先进入 lessonPhase=discussion、closureInquiry=awaiting_confirmation；讨论答疑期间用户提出任何问题都必须保持该状态并继续答疑。',
    '只有用户在当前轮明确没有其他疑问且最终课程总结已经输出时，才能令 lessonPhase=ready_to_close、closureInquiry=confirmed_no_questions、summaryStatus=delivered。',
    '若当前用户消息是在回答你上一轮主动提出的理解检测，必须通过 verificationSignals 上报本轮判断；每轮至多一项，包含 knowledgePointRef、当前用户 sourceMessageId、开放式 category 和 outcome=correct|incorrect|uncertain。category 表示被检验的理解类型，语义相同必须复用账本已有 category，不得换名规避计数。',
    '同一 category 连续两次回答正确后，必须结束该类检验并实质推进：转入下一知识点；若已无知识点则进入综合检测。可见回复不得再次提出同类问题。服务端也会依据 verificationStreak 强制推进。',
    '用户自主提问、表达观点或进行课程邻接探索不属于对主动检测的作答，不要上报 verificationSignals。回答错误或无法判断时应如实上报，正确连续次数会被重置。',
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
  const normalizedRaw = normalizeTerminalTeachingControl(raw);
  const control = extractBetween(normalizedRaw, CONTROL_START, CONTROL_END);
  const markdown = extractBetween(normalizedRaw, REPLY_START, REPLY_END);
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
