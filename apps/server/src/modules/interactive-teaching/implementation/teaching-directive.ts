import { z } from 'zod';

import type { TeachingStateSnapshot } from '@learning-more/contracts';
import type { FullTeachingDirective, TeachingDirective } from '../ports/teaching-agent.js';

const KnowledgePointDirectiveSchema = z
  .strictObject({
    ref: z.string().trim().min(1).max(2_000),
    title: z.string().trim().min(1).max(2_000).optional(),
    status: z.enum(['pending', 'learning', 'completed', 'skipped']),
    interactionStatus: z.enum(['pending', 'completed', 'skipped']),
    depthPreference: z.enum(['default', 'condensed']).optional(),
  })
  .transform((point) => ({
    ref: point.ref,
    status: point.status,
    interactionStatus: point.interactionStatus,
    ...(point.depthPreference === undefined ? {} : { depthPreference: point.depthPreference }),
  }));

const TeachingVerificationSignalSchema = z.strictObject({
  knowledgePointRef: z.string().trim().min(1).max(2_000),
  sourceMessageId: z.string().trim().min(1).max(500),
  category: z.string().trim().min(1).max(500),
  outcome: z.enum(['correct', 'incorrect', 'uncertain']),
});

const TeachingLessonPhaseSchema = z.preprocess(
  (value) => (value === 'comprehensive_check' ? 'comprehensive_application' : value),
  z.enum([
    'warmup',
    'knowledge_point',
    'comprehensive_application',
    'discussion',
    'summary',
    'ready_to_close',
  ]),
);

const FullTeachingDirectiveSchema = z.strictObject({
  schemaVersion: z.literal(1),
  lessonPhase: TeachingLessonPhaseSchema,
  activeKnowledgePointRef: z.string().trim().min(1).max(2_000).optional(),
  knowledgePoints: z.array(KnowledgePointDirectiveSchema),
  difficultySignals: z
    .array(
      z.strictObject({
        knowledgePointRef: z.string().trim().min(1).max(2_000),
        sourceMessageId: z.string().trim().min(1).max(500),
        kind: z.enum([
          'answer_error',
          'misunderstanding',
          'not_understood',
          'request_deeper_explanation',
        ]),
      }),
    )
    .optional(),
  verificationSignals: z.array(TeachingVerificationSignalSchema).max(1).optional(),
  comprehensiveCheck: z.enum(['pending', 'learning', 'completed', 'skipped']),
  closureInquiry: z.enum(['pending', 'awaiting_confirmation', 'confirmed_no_questions']),
  summaryStatus: z.enum(['pending', 'delivered']),
  turnHandoff: z.enum(['invite_response', 'offer_continue']).optional(),
});

const SparseKnowledgePointDirectiveSchema = z.strictObject({
  ref: z.string().trim().min(1).max(2_000),
  status: z.enum(['pending', 'learning', 'completed', 'skipped']).optional(),
  interactionStatus: z.enum(['pending', 'completed', 'skipped']).optional(),
  depthPreference: z.enum(['default', 'condensed']).optional(),
});

const SparseTeachingDirectiveSchema = z
  .strictObject({
    schemaVersion: z.union([z.literal(2), z.literal(3)]),
    lessonPhase: TeachingLessonPhaseSchema.optional(),
    activeKnowledgePointRef: z.string().trim().min(1).max(2_000).nullable().optional(),
    knowledgePoints: z.array(SparseKnowledgePointDirectiveSchema).optional(),
    difficultySignals: z
      .array(
        z.strictObject({
          knowledgePointRef: z.string().trim().min(1).max(2_000),
          sourceMessageId: z.string().trim().min(1).max(500),
          kind: z.enum([
            'answer_error',
            'misunderstanding',
            'not_understood',
            'request_deeper_explanation',
          ]),
        }),
      )
      .optional(),
    verificationSignals: z.array(TeachingVerificationSignalSchema).max(1).optional(),
    comprehensiveApplication: z.enum(['pending', 'learning', 'completed', 'skipped']).optional(),
    comprehensiveCheck: z.enum(['pending', 'learning', 'completed', 'skipped']).optional(),
    closureInquiry: z
      .enum(['pending', 'awaiting_confirmation', 'confirmed_no_questions'])
      .optional(),
    summaryStatus: z.enum(['pending', 'delivered']).optional(),
    turnHandoff: z.enum(['invite_response', 'offer_continue']).optional(),
    interactionPromptExcerpt: z.string().trim().min(1).max(500).optional(),
  })
  .superRefine((directive, context) => {
    if (directive.schemaVersion !== 3) return;
    if (directive.turnHandoff === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['turnHandoff'],
        message: 'teaching_turn_handoff_required',
      });
      return;
    }
    if (
      directive.turnHandoff === 'invite_response' &&
      directive.interactionPromptExcerpt === undefined
    ) {
      context.addIssue({
        code: 'custom',
        path: ['interactionPromptExcerpt'],
        message: 'teaching_interaction_prompt_excerpt_required',
      });
    }
    if (
      directive.turnHandoff === 'offer_continue' &&
      directive.interactionPromptExcerpt !== undefined
    ) {
      context.addIssue({
        code: 'custom',
        path: ['interactionPromptExcerpt'],
        message: 'teaching_interaction_prompt_excerpt_forbidden',
      });
    }
  })
  .transform(({ comprehensiveApplication, comprehensiveCheck, ...directive }) => ({
    ...directive,
    ...((comprehensiveApplication ?? comprehensiveCheck) === undefined
      ? {}
      : { comprehensiveCheck: comprehensiveApplication ?? comprehensiveCheck }),
  }));

export const TeachingDirectiveSchema = z.union([
  FullTeachingDirectiveSchema,
  SparseTeachingDirectiveSchema,
]);

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
  const lessonPhase =
    (state.lessonPhase as string | undefined) === 'comprehensive_check'
      ? 'comprehensive_application'
      : state.lessonPhase;
  return {
    ...state,
    lessonPhase,
    comprehensiveCheck: normalizedComprehensive(state.comprehensiveCheck),
    knowledgePoints: state.knowledgePoints.map((point) => ({
      ...point,
      progress: normalizedProgress(point.progress),
      interactionStatus:
        point.interactionStatus ??
        (normalizedProgress(point.progress) === 'skipped' ? 'skipped' : 'pending'),
      difficultySignals: point.difficultySignals ?? [],
      adaptiveDifficulty:
        point.adaptiveDifficulty === 'difficult' || (point.difficultySignals?.length ?? 0) >= 2
          ? 'difficult'
          : 'normal',
      depthPreference: point.depthPreference ?? 'default',
    })),
  };
}

export function materializeTeachingDirective(
  stateInput: TeachingStateSnapshot,
  directiveInput: unknown,
  validation?: Readonly<{ currentUserMessageId?: string }>,
): FullTeachingDirective {
  const state = normalizeTeachingControlState(stateInput);
  const parsedInput = TeachingDirectiveSchema.parse(directiveInput) as TeachingDirective;
  const knowledgeRefByAlias = new Map(
    state.knowledgePoints.map((point, index) => [`K${index + 1}`, point.ref]),
  );
  const resolveKnowledgeRef = (ref: string) => knowledgeRefByAlias.get(ref) ?? ref;
  const resolveSourceMessageId = (sourceMessageId: string) =>
    sourceMessageId === 'U1' && validation?.currentUserMessageId !== undefined
      ? validation.currentUserMessageId
      : sourceMessageId;
  const parsed: TeachingDirective =
    parsedInput.schemaVersion === 1
      ? parsedInput
      : {
          ...parsedInput,
          ...(parsedInput.activeKnowledgePointRef === undefined ||
          parsedInput.activeKnowledgePointRef === null
            ? {}
            : {
                activeKnowledgePointRef: resolveKnowledgeRef(parsedInput.activeKnowledgePointRef),
              }),
          ...(parsedInput.knowledgePoints === undefined
            ? {}
            : {
                knowledgePoints: parsedInput.knowledgePoints.map((point) => ({
                  ...point,
                  ref: resolveKnowledgeRef(point.ref),
                })),
              }),
          ...(parsedInput.difficultySignals === undefined
            ? {}
            : {
                difficultySignals: parsedInput.difficultySignals.map((signal) => ({
                  ...signal,
                  knowledgePointRef: resolveKnowledgeRef(signal.knowledgePointRef),
                  sourceMessageId: resolveSourceMessageId(signal.sourceMessageId),
                })),
              }),
          ...(parsedInput.verificationSignals === undefined
            ? {}
            : {
                verificationSignals: parsedInput.verificationSignals.map((signal) => ({
                  ...signal,
                  knowledgePointRef: resolveKnowledgeRef(signal.knowledgePointRef),
                  sourceMessageId: resolveSourceMessageId(signal.sourceMessageId),
                })),
              }),
        };
  if (parsed.schemaVersion === 1) {
    return {
      ...parsed,
      verificationSignals: [],
    };
  }

  const updates = parsed.knowledgePoints ?? [];
  const updateRefs = updates.map((point) => point.ref);
  if (new Set(updateRefs).size !== updateRefs.length) {
    invalid('teaching_directive_knowledge_point_update_duplicate');
  }
  const knownRefs = new Set(state.knowledgePoints.map((point) => point.ref));
  if (updateRefs.some((ref) => !knownRefs.has(ref))) {
    invalid('teaching_directive_knowledge_point_update_unknown');
  }
  const updateByRef = new Map(updates.map((point) => [point.ref, point]));
  const currentActive = state.activeKnowledgePointRef;
  const activeKnowledgePointRef =
    parsed.activeKnowledgePointRef === null
      ? undefined
      : (parsed.activeKnowledgePointRef ?? currentActive);

  return {
    schemaVersion: 1,
    lessonPhase: parsed.lessonPhase ?? state.lessonPhase ?? 'warmup',
    ...(activeKnowledgePointRef === undefined ? {} : { activeKnowledgePointRef }),
    knowledgePoints: state.knowledgePoints.map((point) => {
      const update = updateByRef.get(point.ref);
      return {
        ref: point.ref,
        status: update?.status ?? normalizedProgress(point.progress),
        interactionStatus: update?.interactionStatus ?? point.interactionStatus ?? 'pending',
        depthPreference: update?.depthPreference ?? point.depthPreference ?? 'default',
      };
    }),
    difficultySignals: parsed.difficultySignals ?? [],
    verificationSignals: [],
    comprehensiveCheck:
      parsed.comprehensiveCheck ?? normalizedComprehensive(state.comprehensiveCheck),
    closureInquiry: parsed.closureInquiry ?? state.closureInquiry ?? 'pending',
    summaryStatus: parsed.summaryStatus ?? state.summaryStatus ?? 'pending',
    turnHandoff: parsed.turnHandoff ?? state.turnHandoff ?? 'offer_continue',
  };
}

export function teachingDirectiveMatchesState(
  stateInput: TeachingStateSnapshot,
  directiveInput: TeachingDirective,
  validation?: Readonly<{ currentUserMessageId?: string }>,
): boolean {
  const state = normalizeTeachingControlState(stateInput);
  const directive = materializeTeachingDirective(state, directiveInput, validation);
  const statePoints = state.knowledgePoints.map((point) => ({
    ref: point.ref,
    status: normalizedProgress(point.progress),
    interactionStatus: point.interactionStatus ?? 'pending',
    depthPreference: point.depthPreference ?? 'default',
  }));
  const directivePoints = directive.knowledgePoints.map((point) => ({
    ...point,
    depthPreference: point.depthPreference ?? 'default',
  }));
  const unappliedDifficultySignal = (directive.difficultySignals ?? []).some((signal) => {
    const point = state.knowledgePoints.find(
      (candidate) => candidate.ref === signal.knowledgePointRef,
    );
    return !(point?.difficultySignals ?? []).some(
      (existing) =>
        existing.sourceMessageId === signal.sourceMessageId && existing.kind === signal.kind,
    );
  });
  return (
    !unappliedDifficultySignal &&
    (state.lessonPhase ?? 'warmup') === directive.lessonPhase &&
    state.activeKnowledgePointRef === directive.activeKnowledgePointRef &&
    normalizedComprehensive(state.comprehensiveCheck) === directive.comprehensiveCheck &&
    (state.closureInquiry ?? 'pending') === directive.closureInquiry &&
    (state.summaryStatus ?? 'pending') === directive.summaryStatus &&
    (state.turnHandoff ?? 'offer_continue') === directive.turnHandoff &&
    JSON.stringify(statePoints) === JSON.stringify(directivePoints)
  );
}

function invalid(code: string): never {
  throw new Error(code);
}

function closureStateMatchesPhase(directive: FullTeachingDirective): boolean {
  const expected = {
    warmup: ['pending', 'pending'],
    knowledge_point: ['pending', 'pending'],
    comprehensive_application: ['pending', 'pending'],
    discussion: ['awaiting_confirmation', 'pending'],
    summary: ['confirmed_no_questions', 'pending'],
    ready_to_close: ['confirmed_no_questions', 'delivered'],
  } as const satisfies Readonly<
    Record<
      FullTeachingDirective['lessonPhase'],
      readonly [FullTeachingDirective['closureInquiry'], FullTeachingDirective['summaryStatus']]
    >
  >;
  const [closureInquiry, summaryStatus] = expected[directive.lessonPhase];
  return directive.closureInquiry === closureInquiry && directive.summaryStatus === summaryStatus;
}

export function applyTeachingDirective(
  currentInput: TeachingStateSnapshot,
  directiveInput: unknown,
  validation?: Readonly<{
    currentUserMessageId?: string;
    enforceCurrentTurn?: boolean;
  }>,
): TeachingStateSnapshot {
  const current = normalizeTeachingControlState(currentInput);
  const sourceDirective = TeachingDirectiveSchema.parse(directiveInput) as TeachingDirective;
  const directive = materializeTeachingDirective(current, directiveInput, validation);
  const expectedRefs = current.knowledgePoints.map((point) => point.ref);
  const incomingRefs = directive.knowledgePoints.map((point) => point.ref);
  if (
    incomingRefs.length !== expectedRefs.length ||
    new Set(incomingRefs).size !== incomingRefs.length ||
    expectedRefs.some((ref) => !incomingRefs.includes(ref))
  ) {
    invalid('teaching_directive_knowledge_points_mismatch');
  }

  const incomingDifficultySignals = directive.difficultySignals ?? [];
  if (
    validation?.enforceCurrentTurn !== false &&
    validation !== undefined &&
    incomingDifficultySignals.some(
      (signal) => signal.sourceMessageId !== validation.currentUserMessageId,
    )
  ) {
    invalid('teaching_directive_difficulty_signal_source_mismatch');
  }
  if (
    incomingDifficultySignals.some((signal) => !incomingRefs.includes(signal.knowledgePointRef))
  ) {
    invalid('teaching_directive_difficulty_signal_point_unknown');
  }
  const incomingSignalKeys = incomingDifficultySignals.map(
    (signal) => `${signal.knowledgePointRef}\u0000${signal.sourceMessageId}\u0000${signal.kind}`,
  );
  if (new Set(incomingSignalKeys).size !== incomingSignalKeys.length) {
    invalid('teaching_directive_difficulty_signal_duplicate');
  }

  const currentByRef = new Map(current.knowledgePoints.map((point) => [point.ref, point]));
  const newlyCompleted: string[] = [];
  for (const incoming of directive.knowledgePoints) {
    const previous = normalizedProgress(currentByRef.get(incoming.ref)?.progress);
    if ((previous === 'completed' || previous === 'skipped') && incoming.status !== previous) {
      invalid('teaching_directive_completed_point_regression');
    }
    if (previous === 'learning' && incoming.status === 'pending') {
      invalid('teaching_directive_learning_point_regression');
    }
    if (incoming.status === 'completed' && previous !== 'completed' && previous !== 'skipped') {
      newlyCompleted.push(incoming.ref);
    }
    if (incoming.status === 'skipped' && incoming.interactionStatus !== 'skipped') {
      invalid('teaching_directive_skipped_point_interaction_mismatch');
    }
    if (
      incoming.status === 'completed' &&
      incomingDifficultySignals.some(
        (signal) =>
          signal.knowledgePointRef === incoming.ref &&
          ['answer_error', 'misunderstanding', 'not_understood'].includes(signal.kind),
      )
    ) {
      invalid('teaching_directive_point_blocked_by_new_difficulty');
    }
    if (
      incoming.status === 'completed' &&
      current.openLoops.some(
        (loop) => loop.knowledgePointRefs.includes(incoming.ref) && loop.sourceRefs.length > 0,
      )
    ) {
      invalid('teaching_directive_point_blocked_by_open_loop');
    }
  }
  if (sourceDirective.schemaVersion === 3 && newlyCompleted.length > 1) {
    invalid('teaching_directive_multiple_points_completed');
  }
  if (
    sourceDirective.schemaVersion === 3 &&
    newlyCompleted.length === 1 &&
    current.activeKnowledgePointRef !== undefined &&
    newlyCompleted[0] !== current.activeKnowledgePointRef
  ) {
    invalid('teaching_directive_non_active_point_completed');
  }

  const phaseOrder = [
    'warmup',
    'knowledge_point',
    'comprehensive_application',
    'discussion',
    'summary',
    'ready_to_close',
  ] as const;
  const currentPhase = current.lessonPhase ?? 'warmup';
  if (phaseOrder.indexOf(directive.lessonPhase) < phaseOrder.indexOf(currentPhase)) {
    invalid('teaching_directive_phase_regression');
  }
  if (
    directive.lessonPhase === 'warmup' &&
    directive.knowledgePoints.some((point) => {
      const previous = currentByRef.get(point.ref);
      return (
        point.status !== normalizedProgress(previous?.progress) ||
        point.interactionStatus !== (previous?.interactionStatus ?? 'pending')
      );
    })
  ) {
    invalid('teaching_directive_warmup_changed_knowledge_point');
  }

  const settled = directive.knowledgePoints.every(
    (point) => point.status === 'completed' || point.status === 'skipped',
  );
  if (
    ['comprehensive_application', 'discussion', 'summary', 'ready_to_close'].includes(
      directive.lessonPhase,
    ) &&
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
    ['discussion', 'summary', 'ready_to_close'].includes(directive.lessonPhase) &&
    directive.comprehensiveCheck !== 'completed' &&
    directive.comprehensiveCheck !== 'skipped'
  ) {
    invalid('teaching_directive_comprehensive_unsettled');
  }
  if (!closureStateMatchesPhase(directive)) {
    invalid('teaching_directive_closure_state_mismatch');
  }
  const attemptsClosure =
    directive.closureInquiry === 'confirmed_no_questions' ||
    directive.summaryStatus === 'delivered' ||
    directive.lessonPhase === 'ready_to_close';
  if (
    attemptsClosure &&
    currentPhase !== 'comprehensive_application' &&
    currentPhase !== 'discussion' &&
    currentPhase !== 'summary' &&
    currentPhase !== 'ready_to_close'
  ) {
    invalid('teaching_directive_discussion_required_before_closure');
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
    turnHandoff: directive.turnHandoff ?? 'offer_continue',
    knowledgePoints: current.knowledgePoints.map((point) => {
      const incoming = incomingByRef.get(point.ref)!;
      const difficultySignals = [...(point.difficultySignals ?? [])];
      for (const signal of incomingDifficultySignals.filter(
        (candidate) => candidate.knowledgePointRef === point.ref,
      )) {
        if (
          difficultySignals.some(
            (existing) =>
              existing.sourceMessageId === signal.sourceMessageId && existing.kind === signal.kind,
          )
        ) {
          continue;
        }
        difficultySignals.push({ sourceMessageId: signal.sourceMessageId, kind: signal.kind });
      }
      return {
        ...point,
        progress: incoming.status,
        interactionStatus: incoming.interactionStatus,
        difficultySignals,
        adaptiveDifficulty: difficultySignals.length >= 2 ? 'difficult' : 'normal',
        depthPreference: incoming.depthPreference ?? point.depthPreference ?? 'default',
      };
    }),
  };
}
