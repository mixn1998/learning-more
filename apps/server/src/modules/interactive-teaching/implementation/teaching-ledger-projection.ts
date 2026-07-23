import type { TeachingContextPackage } from '../ports/teaching-context-sources.js';
import { normalizeTeachingControlState } from './teaching-directive.js';

type ProjectedKnowledgePoint = Readonly<{
  ref: string;
  title: string;
  status: 'pending' | 'learning' | 'completed' | 'skipped';
  interactionStatus: 'pending' | 'completed' | 'skipped';
  depthPreference: 'default' | 'condensed';
  delivery: 'not_addressed' | 'explained';
  verification: 'not_observed' | 'supporting' | 'limiting' | 'mixed';
  adaptiveDifficulty: 'normal' | 'difficult';
  deepFollowUpCount: number;
  verificationStreak?: Readonly<{
    category: string;
    correctCount: number;
  }>;
}>;

export type TeachingLedgerProjection = Readonly<{
  mode: 'local' | 'compact_full';
  lessonPhase:
    | 'warmup'
    | 'knowledge_point'
    | 'comprehensive_check'
    | 'discussion'
    | 'summary'
    | 'ready_to_close';
  activeKnowledgePointRef?: string;
  knowledgePoints: readonly ProjectedKnowledgePoint[];
  nextKnowledgePoint?: Readonly<{ ref: string; title: string }>;
  completedOrSkippedCount: number;
  totalKnowledgePointCount: number;
  allKnowledgePointsTerminal: boolean;
  comprehensiveCheck: 'pending' | 'learning' | 'completed' | 'skipped';
  closureInquiry: 'pending' | 'awaiting_confirmation' | 'confirmed_no_questions';
  summaryStatus: 'pending' | 'delivered';
}>;

const AMBIGUOUS_BACK_REFERENCE =
  /(?:(?:之前|前面|刚才|上一个|那个|某个)(?:的)?(?:知识点|概念|内容)?|(?:后面|剩下|其余|全部|所有|这些)(?:的)?(?:知识点|概念|内容|互动)?)/u;

function currentUserRequest(context: TeachingContextPackage): string {
  return (
    context.recentMessages.findLast(
      (message) => message.role === 'user' && message.completionStatus === 'complete',
    )?.markdown ?? ''
  ).trim();
}

function endpointPhase(phase: TeachingLedgerProjection['lessonPhase']): boolean {
  return ['comprehensive_check', 'discussion', 'summary', 'ready_to_close'].includes(phase);
}

function normalizedProgress(
  value:
    | 'pending'
    | 'learning'
    | 'completed'
    | 'skipped'
    | 'teaching'
    | 'checking'
    | 'passed'
    | undefined,
): ProjectedKnowledgePoint['status'] {
  if (value === 'teaching' || value === 'checking') return 'learning';
  if (value === 'passed') return 'completed';
  return value ?? 'pending';
}

export function projectTeachingLedger(context: TeachingContextPackage): TeachingLedgerProjection {
  const state = normalizeTeachingControlState(context.teachingState);
  const phase = state.lessonPhase ?? 'warmup';
  const ordered = context.lesson.coreKnowledgePoints.map((definition) => {
    const point = state.knowledgePoints.find((candidate) => candidate.ref === definition.ref);
    return {
      ref: definition.ref,
      title: definition.text,
      status: normalizedProgress(point?.progress),
      interactionStatus: point?.interactionStatus ?? 'pending',
      depthPreference: point?.depthPreference ?? 'default',
      delivery: point?.delivery ?? 'not_addressed',
      verification: point?.verification ?? 'not_observed',
      adaptiveDifficulty: point?.adaptiveDifficulty ?? 'normal',
      deepFollowUpCount: (point?.difficultySignals ?? []).filter(
        (signal) => signal.kind === 'request_deeper_explanation',
      ).length,
      ...(point?.verificationStreak === undefined
        ? {}
        : {
            verificationStreak: {
              category: point.verificationStreak.category,
              correctCount: point.verificationStreak.correctCount,
            },
          }),
    } satisfies ProjectedKnowledgePoint;
  });
  const completedOrSkippedCount = ordered.filter(
    (point) => point.status === 'completed' || point.status === 'skipped',
  ).length;
  const activeIndex = ordered.findIndex((point) => point.ref === state.activeKnowledgePointRef);
  const fallbackIndex = ordered.findIndex(
    (point) => point.status === 'learning' || point.status === 'pending',
  );
  const currentIndex = activeIndex >= 0 ? activeIndex : fallbackIndex;
  const next = ordered
    .slice(Math.max(0, currentIndex + 1))
    .find((point) => point.status !== 'completed' && point.status !== 'skipped');
  const request = currentUserRequest(context);
  const explicitlyReferenced = ordered.filter(
    (point, index) =>
      index !== currentIndex && point.title.length >= 2 && request.includes(point.title),
  );
  const compactFull = endpointPhase(phase) || AMBIGUOUS_BACK_REFERENCE.test(request);
  const localRefs = new Set([
    ...(currentIndex < 0 ? [] : [ordered[currentIndex]!.ref]),
    ...(next === undefined ? [] : [next.ref]),
    ...explicitlyReferenced.map((point) => point.ref),
  ]);

  return {
    mode: compactFull ? 'compact_full' : 'local',
    lessonPhase: phase,
    ...(state.activeKnowledgePointRef === undefined
      ? {}
      : { activeKnowledgePointRef: state.activeKnowledgePointRef }),
    knowledgePoints: compactFull ? ordered : ordered.filter((point) => localRefs.has(point.ref)),
    ...(next === undefined ? {} : { nextKnowledgePoint: { ref: next.ref, title: next.title } }),
    completedOrSkippedCount,
    totalKnowledgePointCount: ordered.length,
    allKnowledgePointsTerminal: completedOrSkippedCount === ordered.length,
    comprehensiveCheck: normalizedProgress(state.comprehensiveCheck),
    closureInquiry: state.closureInquiry ?? 'pending',
    summaryStatus: state.summaryStatus ?? 'pending',
  };
}
