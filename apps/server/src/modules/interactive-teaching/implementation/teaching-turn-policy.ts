import type { TeachingContextPackage } from '../ports/teaching-context-sources.js';
import { normalizeTeachingControlState } from './teaching-directive.js';

export type TeachingReasoningEffort = 'low' | 'medium' | 'high';

const FOLLOW_UP_PATTERN =
  /(?:为什么|为何|怎么|如何|能否|可以再|再讲|深入|详细|展开|举例|例子|反例|证明|推导|边界|条件|区别|对比|没懂|不理解|还是不明白|什么意思|[?？])/u;

function currentUserRequest(context: TeachingContextPackage): string {
  return (
    context.recentMessages.findLast(
      (message) => message.role === 'user' && message.completionStatus === 'complete',
    )?.markdown ?? ''
  ).trim();
}

function priorDeepFollowUpCount(context: TeachingContextPackage, pointRef: string): number {
  const state = normalizeTeachingControlState(context.teachingState);
  const point = state.knowledgePoints.find((candidate) => candidate.ref === pointRef);
  return (point?.difficultySignals ?? []).filter(
    (signal) => signal.kind === 'request_deeper_explanation',
  ).length;
}

function isSubstantiveFollowUp(context: TeachingContextPackage): boolean {
  if (context.turnKind === 'opening') return false;
  return FOLLOW_UP_PATTERN.test(currentUserRequest(context));
}

/**
 * Selects model effort from durable teaching state plus the current request.
 * Follow-up history is deliberately scoped by the current session snapshot and
 * active knowledge-point ref. Leaving a point does not erase its signals, so a
 * later visit resumes the existing count without leaking counts across points.
 */
export function reasoningEffortForTeachingTurn(
  context: TeachingContextPackage,
): TeachingReasoningEffort {
  const state = normalizeTeachingControlState(context.teachingState);
  const phase = state.lessonPhase ?? 'warmup';

  if (context.turnKind === 'opening' || phase === 'warmup') return 'low';
  if (phase === 'summary' || phase === 'ready_to_close') return 'low';
  if (phase === 'comprehensive_check' || phase === 'discussion') return 'medium';
  if (phase !== 'knowledge_point') return 'medium';

  const activeRef = state.activeKnowledgePointRef;
  if (activeRef === undefined) return 'medium';
  const definition = context.lesson.coreKnowledgePoints.find((point) => point.ref === activeRef);
  const pointState = state.knowledgePoints.find((point) => point.ref === activeRef);
  const substantiveFollowUp = isSubstantiveFollowUp(context);

  if (substantiveFollowUp && priorDeepFollowUpCount(context, activeRef) >= 1) return 'high';
  if (
    substantiveFollowUp ||
    definition?.fixedImportance === 'key' ||
    pointState?.adaptiveDifficulty === 'difficult'
  ) {
    return 'medium';
  }
  return 'low';
}
