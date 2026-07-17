import { z } from 'zod';

import type { TeachingStateSnapshot } from '@learning-more/contracts';
import type { TeachingDirective } from '../ports/teaching-agent.js';

const KnowledgePointDirectiveSchema = z.strictObject({
  ref: z.string().trim().min(1).max(2_000),
  title: z.string().trim().min(1).max(2_000).optional(),
  status: z.enum(['pending', 'learning', 'completed', 'skipped']),
  interactionStatus: z.enum(['pending', 'completed', 'skipped']),
}).transform((point) => ({
  ref: point.ref,
  status: point.status,
  interactionStatus: point.interactionStatus,
}));

export const TeachingDirectiveSchema = z.strictObject({
  schemaVersion: z.literal(1),
  lessonPhase: z.enum([
    'warmup',
    'knowledge_point',
    'comprehensive_check',
    'summary',
    'ready_to_close',
  ]),
  activeKnowledgePointRef: z.string().trim().min(1).max(2_000).optional(),
  knowledgePoints: z.array(KnowledgePointDirectiveSchema),
  comprehensiveCheck: z.enum(['pending', 'learning', 'completed', 'skipped']),
  closureInquiry: z.enum(['pending', 'awaiting_confirmation', 'confirmed_no_questions']),
  summaryStatus: z.enum(['pending', 'delivered']),
});

function normalizedProgress(
  progress: TeachingStateSnapshot['knowledgePoints'][number]['progress'],
): 'pending' | 'learning' | 'completed' | 'skipped' {
  if (progress === 'passed' || progress === 'completed') return 'completed';
  if (progress === 'teaching' || progress === 'checking' || progress === 'learning') {
    return 'learning';
  }
  return progress ?? 'pending';
}

function normalizedComprehensive(
  status: TeachingStateSnapshot['comprehensiveCheck'],
): 'pending' | 'learning' | 'completed' | 'skipped' {
  if (status === 'passed' || status === 'completed') return 'completed';
  if (status === 'checking' || status === 'learning') return 'learning';
  return status ?? 'pending';
}

export function normalizeTeachingControlState(state: TeachingStateSnapshot): TeachingStateSnapshot {
  return {
    ...state,
    comprehensiveCheck: normalizedComprehensive(state.comprehensiveCheck),
    knowledgePoints: state.knowledgePoints.map((point) => ({
      ...point,
      progress: normalizedProgress(point.progress),
      interactionStatus:
        point.interactionStatus ??
        (normalizedProgress(point.progress) === 'skipped' ? 'skipped' : 'pending'),
    })),
  };
}

export function teachingDirectiveMatchesState(
  stateInput: TeachingStateSnapshot,
  directive: TeachingDirective,
): boolean {
  const state = normalizeTeachingControlState(stateInput);
  const statePoints = state.knowledgePoints.map((point) => ({
    ref: point.ref,
    status: normalizedProgress(point.progress),
    interactionStatus: point.interactionStatus ?? 'pending',
  }));
  return (
    (state.lessonPhase ?? 'warmup') === directive.lessonPhase &&
    state.activeKnowledgePointRef === directive.activeKnowledgePointRef &&
    normalizedComprehensive(state.comprehensiveCheck) === directive.comprehensiveCheck &&
    (state.closureInquiry ?? 'pending') === directive.closureInquiry &&
    (state.summaryStatus ?? 'pending') === directive.summaryStatus &&
    JSON.stringify(statePoints) === JSON.stringify(directive.knowledgePoints)
  );
}

function invalid(code: string): never {
  throw new Error(code);
}

export function applyTeachingDirective(
  currentInput: TeachingStateSnapshot,
  directiveInput: unknown,
): TeachingStateSnapshot {
  const current = normalizeTeachingControlState(currentInput);
  const directive = TeachingDirectiveSchema.parse(directiveInput) as TeachingDirective;
  const expectedRefs = current.knowledgePoints.map((point) => point.ref);
  const incomingRefs = directive.knowledgePoints.map((point) => point.ref);
  if (
    incomingRefs.length !== expectedRefs.length ||
    new Set(incomingRefs).size !== incomingRefs.length ||
    expectedRefs.some((ref) => !incomingRefs.includes(ref))
  ) {
    invalid('teaching_directive_knowledge_points_mismatch');
  }

  const currentByRef = new Map(current.knowledgePoints.map((point) => [point.ref, point]));
  for (const incoming of directive.knowledgePoints) {
    const previous = normalizedProgress(currentByRef.get(incoming.ref)?.progress);
    if ((previous === 'completed' || previous === 'skipped') && incoming.status !== previous) {
      invalid('teaching_directive_completed_point_regression');
    }
    if (previous === 'learning' && incoming.status === 'pending') {
      invalid('teaching_directive_learning_point_regression');
    }
    if (incoming.status === 'completed' && incoming.interactionStatus === 'pending') {
      invalid('teaching_directive_completed_interaction_unsettled');
    }
    if (incoming.status === 'skipped' && incoming.interactionStatus !== 'skipped') {
      invalid('teaching_directive_skipped_point_interaction_mismatch');
    }
  }

  const phaseOrder = [
    'warmup',
    'knowledge_point',
    'comprehensive_check',
    'summary',
    'ready_to_close',
  ] as const;
  const currentPhase = current.lessonPhase ?? 'warmup';
  if (phaseOrder.indexOf(directive.lessonPhase) < phaseOrder.indexOf(currentPhase)) {
    invalid('teaching_directive_phase_regression');
  }

  const settled = directive.knowledgePoints.every(
    (point) => point.status === 'completed' || point.status === 'skipped',
  );
  if (
    ['comprehensive_check', 'summary', 'ready_to_close'].includes(directive.lessonPhase) &&
    !settled
  ) {
    invalid('teaching_directive_knowledge_points_unsettled');
  }
  if (
    directive.activeKnowledgePointRef !== undefined &&
    !incomingRefs.includes(directive.activeKnowledgePointRef)
  ) {
    invalid('teaching_directive_active_point_unknown');
  }
  if (
    directive.lessonPhase === 'knowledge_point' &&
    directive.activeKnowledgePointRef === undefined
  ) {
    invalid('teaching_directive_active_point_required');
  }
  if (
    directive.lessonPhase === 'knowledge_point' &&
    directive.knowledgePoints.find((point) => point.ref === directive.activeKnowledgePointRef)
      ?.status !== 'learning'
  ) {
    invalid('teaching_directive_active_point_not_learning');
  }
  if (
    !['warmup', 'knowledge_point'].includes(directive.lessonPhase) &&
    directive.activeKnowledgePointRef !== undefined
  ) {
    invalid('teaching_directive_active_point_forbidden');
  }

  const currentComprehensive = normalizedComprehensive(current.comprehensiveCheck);
  if (
    (currentComprehensive === 'completed' || currentComprehensive === 'skipped') &&
    directive.comprehensiveCheck !== currentComprehensive
  ) {
    invalid('teaching_directive_comprehensive_regression');
  }
  if (
    (directive.lessonPhase === 'summary' || directive.lessonPhase === 'ready_to_close') &&
    directive.comprehensiveCheck !== 'completed' &&
    directive.comprehensiveCheck !== 'skipped'
  ) {
    invalid('teaching_directive_comprehensive_unsettled');
  }
  if (
    directive.summaryStatus === 'delivered' &&
    directive.closureInquiry !== 'confirmed_no_questions'
  ) {
    invalid('teaching_directive_summary_before_confirmation');
  }
  if (
    directive.lessonPhase === 'ready_to_close' &&
    (directive.summaryStatus !== 'delivered' ||
      directive.closureInquiry !== 'confirmed_no_questions')
  ) {
    invalid('teaching_directive_closure_incomplete');
  }

  const incomingByRef = new Map(directive.knowledgePoints.map((point) => [point.ref, point]));
  const { activeKnowledgePointRef: _active, ...withoutActive } = current;
  void _active;
  return {
    ...withoutActive,
    ledgerVersion: current.ledgerVersion + 1,
    lessonPhase: directive.lessonPhase,
    ...(directive.activeKnowledgePointRef === undefined
      ? {}
      : { activeKnowledgePointRef: directive.activeKnowledgePointRef }),
    comprehensiveCheck: directive.comprehensiveCheck,
    closureInquiry: directive.closureInquiry,
    summaryStatus: directive.summaryStatus,
    knowledgePoints: current.knowledgePoints.map((point) => {
      const incoming = incomingByRef.get(point.ref)!;
      return {
        ...point,
        progress: incoming.status,
        interactionStatus: incoming.interactionStatus,
      };
    }),
  };
}
