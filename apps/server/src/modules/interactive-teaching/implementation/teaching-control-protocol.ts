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
  const knowledgeAliasByRef = new Map(
    context.lesson.coreKnowledgePoints.map((point, index) => [point.ref, `K${index + 1}`]),
  );
  const knowledgeAlias = (ref: string) => knowledgeAliasByRef.get(ref) ?? ref;
  const currentUserMessageId = context.recentMessages.findLast(
    (message) => message.role === 'user' && message.completionStatus === 'complete',
  )?.messageId;
  return JSON.stringify({
    schemaVersion: 1,
    lessonPhase: projection.lessonPhase,
    projectionMode: projection.mode,
    ...(projection.activeKnowledgePointRef === undefined
      ? {}
      : { activeKnowledgePointRef: knowledgeAlias(projection.activeKnowledgePointRef) }),
    knowledgePoints: projection.knowledgePoints.map((point) => ({
      ref: knowledgeAlias(point.ref),
      title: point.title,
      status: point.status,
      interactionStatus: point.interactionStatus,
      depthPreference: point.depthPreference,
      deepFollowUpCount: point.deepFollowUpCount,
    })),
    ...(projection.nextKnowledgePoint === undefined
      ? {}
      : {
          nextKnowledgePoint: {
            ref: knowledgeAlias(projection.nextKnowledgePoint.ref),
            title: projection.nextKnowledgePoint.title,
          },
        }),
    progress: {
      completedOrSkipped: projection.completedOrSkippedCount,
      total: projection.totalKnowledgePointCount,
      allTerminal: projection.allKnowledgePointsTerminal,
    },
    difficultySignals: [],
    ...(context.turnKind === 'opening' || currentUserMessageId === undefined
      ? {}
      : {
          allowedDifficultySignalSourceMessageId: 'U1',
        }),
    comprehensiveApplication: projection.comprehensiveCheck,
    closureInquiry: projection.closureInquiry,
    summaryStatus: projection.summaryStatus,
    turnHandoff: context.teachingState.turnHandoff ?? 'offer_continue',
  });
}

export function renderTeachingControlProtocol(context: TeachingContextPackage): string {
  const compactReferenceProtocol = [
    '知识点引用只使用当前机器状态中的 K1、K2 等短编号；不要复制或创造内部知识点长标识。',
    'difficultySignals.sourceMessageId 只使用当前机器状态允许的 U1；服务端会确定性映射回真实消息。',
  ].join('\n');
  return [
    compactReferenceProtocol,
    '【机器控制协议｜不得展示给学习者】',
    '严格输出两个区块：先给学习者可见回复，再给隐藏控制 JSON：',
    `${REPLY_START}{仅供学习者阅读的 Markdown}${REPLY_END}`,
    `${CONTROL_START}{schemaVersion=3 的稀疏 JSON 教学状态变更}${CONTROL_END}`,
    '可见回复必须完整且不得混入控制内容。控制 JSON 使用 schemaVersion=3，只返回本轮变化；其余状态由服务端权威账本补齐。',
    'lessonPhase 每轮必须返回，且只能是 warmup|knowledge_point|comprehensive_application|discussion|summary|ready_to_close；即使阶段未变化也必须返回当前值。',
    'knowledgePoints 仅列变化项，每项含 ref 及发生变化的 status、interactionStatus、depthPreference；无变化则省略。difficultySignals 同理。',
    'activeKnowledgePointRef 仅在发生变化时返回；需要清除当前知识点时明确返回 null。status 只能是 pending|learning|completed|skipped，interactionStatus 只能是 pending|completed|skipped，depthPreference 只能是 default|condensed。',
    '仅当用户当前原话明确要求简要带过时，才将对应 depthPreference 设为 condensed；之后明确要求深入可恢复 default。它只影响本会话教学深度，不改课程预设重点。',
    'status=completed 表示该知识点的必要讲解已经完成，且当前没有尚未处理的相关疑问、回答错误、误解或不理解。知识点互动不是完成前提；本知识点没有发出互动邀请时，interactionStatus 可保持 pending。',
    '如果已经发出尚待学习者回应的互动邀请，保持 status=learning、interactionStatus=pending；学习者响应后使用 interactionStatus=completed，明确不展开或跳过互动时使用 interactionStatus=skipped。',
    '每轮最多新完成一个主链知识点，而且只能完成本轮开始时的 activeKnowledgePointRef。完成当前点后可以把 activeKnowledgePointRef 切换到相邻下一点，但未在本轮可见回复中展开的下一主链节点保持 pending；只有回复确实属于某知识点时，才能把该点设为 learning 或 completed。',
    '完成最后一个知识点后可以清除 activeKnowledgePointRef，将 lessonPhase 设为 comprehensive_application；本轮 comprehensiveApplication 保持 pending，可见回复不得同时展开综合应用。下一轮实际展开综合应用时再设为 learning。',
    'difficultySignals 只上报当前用户原话对具体知识点产生的新信号，每项含 knowledgePointRef、sourceMessageId、kind；kind∈answer_error|misunderstanding|not_understood|request_deeper_explanation。',
    '四类信号独立计数；同一消息可上报不同 kind、不可重复同一 kind。延伸、脑洞或相邻探索不计；无新信号时省略。',
    '用户跳过整个知识点时使用 status=skipped 且 interactionStatus=skipped；只跳过已经发出的知识点互动时，必要讲解和相关阻塞项处理完成后使用 status=completed、interactionStatus=skipped。',
    'comprehensiveApplication∈pending|learning|completed|skipped；跳过综合应用用 skipped。节点终态不得倒退；全部知识点终态后才能进入 comprehensive_application，综合应用终态后才能进入 discussion。',
    '综合应用只提供一次。学习者完成回应或明确跳过后，将 comprehensiveApplication 设为 completed 或 skipped，并进入 lessonPhase=discussion、closureInquiry=awaiting_confirmation；讨论答疑期间用户提出任何问题都必须保持该状态并继续答疑。',
    '只有用户在当前轮明确没有其他疑问且最终课程总结已经输出时，才能令 lessonPhase=ready_to_close、closureInquiry=confirmed_no_questions、summaryStatus=delivered。',
    '每轮必须返回 turnHandoff。只有可见回复确实向学习者发出具有教学价值的回应邀请时使用 invite_response，并同时返回 interactionPromptExcerpt；该字段必须逐字摘录可见回复中的邀请。其他情况使用 offer_continue，且不得返回 interactionPromptExcerpt；界面会提供“继续讲解”，不需要学习者发送占位消息。',
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
  if (
    directive?.schemaVersion === 3 &&
    directive.turnHandoff === 'invite_response' &&
    !markdown
      .replace(/\s+/gu, ' ')
      .includes((directive.interactionPromptExcerpt ?? '').replace(/\s+/gu, ' '))
  ) {
    throw new Error('teaching_interaction_prompt_not_in_reply');
  }
  return { markdown, directive };
}

export function parseInterruptedTeachingMarkdown(raw: string): string {
  return extractBetween(raw, REPLY_START, REPLY_END) ?? '';
}
