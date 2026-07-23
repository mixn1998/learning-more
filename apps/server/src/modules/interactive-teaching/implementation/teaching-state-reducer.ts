import type {
  TeachingObservation,
  TeachingObservationEntry,
  TeachingStateSnapshot,
} from '@learning-more/contracts';
import { normalizeTeachingControlState } from './teaching-directive.js';

const EMPTY_SNAPSHOT_HASH = '0'.repeat(64);

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function createTeachingState(input: {
  lessonId: string;
  sessionId: string;
  knowledgePointRefs: readonly string[];
}): TeachingStateSnapshot {
  const orderedKnowledgePointRefs = [...new Set(input.knowledgePointRefs)];
  return {
    schemaVersion: 1,
    lessonId: input.lessonId,
    sessionId: input.sessionId,
    ledgerVersion: 0,
    sourceSnapshotHash: EMPTY_SNAPSHOT_HASH,
    observationStatus: 'current',
    scopeStatus: 'aligned',
    evidenceCheckpoint: false,
    lessonPhase: 'warmup',
    ...(orderedKnowledgePointRefs[0] === undefined
      ? {}
      : { activeKnowledgePointRef: orderedKnowledgePointRefs[0] }),
    comprehensiveCheck: 'pending',
    closureInquiry: 'pending',
    summaryStatus: 'pending',
    knowledgePoints: orderedKnowledgePointRefs.map((ref) => ({
      ref,
      progress: 'pending',
      interactionStatus: 'pending',
      delivery: 'not_addressed',
      verification: 'not_observed',
      teachingEvidenceRefs: [],
      learnerEvidenceRefs: [],
      unresolvedEntryRefs: [],
      difficultySignals: [],
      adaptiveDifficulty: 'normal',
    })),
    openLoops: [],
    explorationBranches: [],
    recentLearnerSignals: [],
  };
}

export function alignTeachingState(
  current: TeachingStateSnapshot,
  knowledgePointRefs: readonly string[],
): TeachingStateSnapshot {
  const baseline = createTeachingState({
    lessonId: current.lessonId,
    sessionId: current.sessionId,
    knowledgePointRefs,
  });
  const normalizedCurrent = normalizeTeachingControlState(current);
  const currentByRef = new Map(
    normalizedCurrent.knowledgePoints.map((point) => [point.ref, point]),
  );
  const knowledgePoints = baseline.knowledgePoints.map(
    (point) => currentByRef.get(point.ref) ?? point,
  );
  const activeStillExists = knowledgePoints.some(
    (point) => point.ref === normalizedCurrent.activeKnowledgePointRef,
  );
  const activeKnowledgePointRef = activeStillExists
    ? normalizedCurrent.activeKnowledgePointRef
    : knowledgePoints.find(
        (point) => point.progress !== 'completed' && point.progress !== 'skipped',
      )?.ref;
  const { activeKnowledgePointRef: _previousActiveKnowledgePointRef, ...currentWithoutActive } =
    normalizedCurrent;
  void _previousActiveKnowledgePointRef;
  const comprehensiveCheck = normalizedCurrent.comprehensiveCheck ?? 'pending';
  const closureInquiry =
    normalizedCurrent.closureInquiry ??
    (normalizedCurrent.lessonPhase === 'ready_to_close'
      ? 'confirmed_no_questions'
      : comprehensiveCheck === 'completed' || comprehensiveCheck === 'skipped'
        ? 'awaiting_confirmation'
        : 'pending');
  return {
    ...currentWithoutActive,
    lessonPhase: normalizedCurrent.lessonPhase ?? 'warmup',
    comprehensiveCheck,
    closureInquiry,
    summaryStatus:
      closureInquiry === 'confirmed_no_questions'
        ? (normalizedCurrent.summaryStatus ?? 'pending')
        : 'pending',
    knowledgePoints,
    ...(activeKnowledgePointRef === undefined ? {} : { activeKnowledgePointRef }),
  };
}

function verificationAfter(
  current: TeachingStateSnapshot['knowledgePoints'][number]['verification'],
  assessment: TeachingObservationEntry['assessment'],
): TeachingStateSnapshot['knowledgePoints'][number]['verification'] {
  if (assessment === undefined || assessment === 'uncertain') return current;
  const incoming = assessment === 'supports' ? 'supporting' : 'limiting';
  if (current === 'not_observed' || current === incoming) return incoming;
  return 'mixed';
}

function isLearnerSignal(entry: TeachingObservationEntry): boolean {
  return [
    'learner_demonstration',
    'learner_misconception',
    'learner_question',
    'learner_intent',
    'learner_reasoning_behavior',
    'adjacent_exploration',
  ].includes(entry.kind);
}

function establishesCheckpoint(
  observation: TeachingObservation,
  entry: TeachingObservationEntry,
): boolean {
  return (
    observation.scope.alignment !== 'unclear' &&
    observation.scope.alignment !== 'off_scope' &&
    entry.kind !== 'open_loop' &&
    entry.qualityFlags.includes('complete')
  );
}

export function reduceTeachingState(
  current: TeachingStateSnapshot,
  observation: TeachingObservation,
): TeachingStateSnapshot {
  if (observation.status !== 'active') return current;
  if (observation.lessonId !== current.lessonId || observation.sessionId !== current.sessionId) {
    throw new Error('observation_state_identity_mismatch');
  }

  const resolvedEntryRefs = new Set(
    observation.entries.flatMap((entry) => [...entry.resolvesEntryRefs]),
  );
  if (
    observation.entries.some((entry) => entry.progressionSignal === 'confirm_no_further_questions')
  ) {
    for (const loop of current.openLoops) resolvedEntryRefs.add(loop.entryId);
  }
  const openLoops = current.openLoops.filter((loop) => !resolvedEntryRefs.has(loop.entryId));
  const explorationBranches = current.explorationBranches.map((branch) =>
    resolvedEntryRefs.has(branch.entryId) ? { ...branch, status: 'returned' as const } : branch,
  );
  const knowledgePoints = current.knowledgePoints.map((knowledgePoint) => ({
    ...knowledgePoint,
    progress: knowledgePoint.progress ?? ('pending' as const),
    interactionStatus: knowledgePoint.interactionStatus ?? ('pending' as const),
    unresolvedEntryRefs: knowledgePoint.unresolvedEntryRefs.filter(
      (entryRef) => !resolvedEntryRefs.has(entryRef),
    ),
  }));
  const recentLearnerSignals = [...current.recentLearnerSignals];
  let evidenceCheckpoint = current.evidenceCheckpoint;
  const comprehensiveCheck = current.comprehensiveCheck ?? 'pending';
  const closureInquiry =
    current.closureInquiry ??
    (current.lessonPhase === 'ready_to_close'
      ? 'confirmed_no_questions'
      : comprehensiveCheck === 'completed' || comprehensiveCheck === 'skipped'
        ? 'awaiting_confirmation'
        : 'pending');
  const summaryStatus =
    closureInquiry === 'confirmed_no_questions' ? (current.summaryStatus ?? 'pending') : 'pending';

  for (const entry of observation.entries) {
    if (establishesCheckpoint(observation, entry)) evidenceCheckpoint = true;

    if (entry.kind === 'open_loop' && !resolvedEntryRefs.has(entry.entryId)) {
      const existingIndex = openLoops.findIndex((loop) => loop.entryId === entry.entryId);
      const loop = {
        entryId: entry.entryId,
        summary: entry.summary,
        knowledgePointRefs: unique(entry.knowledgePointRefs),
        sourceRefs: unique(entry.sourceRefs),
      };
      if (existingIndex === -1) openLoops.push(loop);
      else openLoops[existingIndex] = loop;
      for (const ref of entry.knowledgePointRefs) {
        const index = knowledgePoints.findIndex((item) => item.ref === ref);
        if (index !== -1) {
          const point = knowledgePoints[index]!;
          knowledgePoints[index] = {
            ...point,
            unresolvedEntryRefs: unique([...point.unresolvedEntryRefs, entry.entryId]),
          };
        }
      }
    }

    if (entry.kind === 'adjacent_exploration') {
      const courseTopicRefs = observation.scope.relationRefs.filter((ref) =>
        ref.startsWith('course-topic:'),
      );
      const returnAnchorRefs = unique([
        ...entry.knowledgePointRefs,
        ...observation.scope.relationRefs.filter((ref) => ref.startsWith('knowledge:')),
      ]);
      const branch = {
        entryId: entry.entryId,
        summary: entry.summary,
        courseTopicRefs:
          courseTopicRefs.length === 0 ? [`lesson:${current.lessonId}`] : unique(courseTopicRefs),
        sourceRefs: unique(entry.sourceRefs),
        returnAnchorRefs:
          returnAnchorRefs.length === 0 ? [`lesson:${current.lessonId}`] : returnAnchorRefs,
        status: 'active' as const,
      };
      const existingIndex = explorationBranches.findIndex(
        (candidate) => candidate.entryId === entry.entryId,
      );
      if (existingIndex === -1) explorationBranches.push(branch);
      else explorationBranches[existingIndex] = branch;
    }

    const mayUpdateLesson =
      observation.scope.alignment === 'direct' || observation.scope.alignment === 'supporting';
    if (mayUpdateLesson && entry.kind === 'teaching_delivery') {
      for (const ref of entry.knowledgePointRefs) {
        const index = knowledgePoints.findIndex((item) => item.ref === ref);
        if (index !== -1) {
          const point = knowledgePoints[index]!;
          knowledgePoints[index] = {
            ...point,
            delivery: 'explained',
            teachingEvidenceRefs: unique([...point.teachingEvidenceRefs, ...entry.sourceRefs]),
          };
        }
      }
    }
    if (
      mayUpdateLesson &&
      (entry.kind === 'learner_demonstration' || entry.kind === 'learner_misconception')
    ) {
      const assessment =
        entry.kind === 'learner_misconception' ? (entry.assessment ?? 'limits') : entry.assessment;
      for (const ref of entry.knowledgePointRefs) {
        const index = knowledgePoints.findIndex((item) => item.ref === ref);
        if (index !== -1) {
          const point = knowledgePoints[index]!;
          knowledgePoints[index] = {
            ...point,
            verification: verificationAfter(point.verification, assessment),
            learnerEvidenceRefs: unique([...point.learnerEvidenceRefs, ...entry.sourceRefs]),
          };
        }
      }
    }
    if (isLearnerSignal(entry)) {
      const signal = {
        entryId: entry.entryId,
        summary: entry.summary,
        explicitness: entry.explicitness ?? ('ai_observed' as const),
        sourceRefs: unique(entry.sourceRefs),
      };
      const existingIndex = recentLearnerSignals.findIndex(
        (candidate) => candidate.entryId === entry.entryId,
      );
      if (existingIndex === -1) recentLearnerSignals.push(signal);
      else recentLearnerSignals[existingIndex] = signal;
    }
  }

  const hasActiveBranch = explorationBranches.some((branch) => branch.status === 'active');
  const needsReturn =
    hasActiveBranch ||
    observation.scope.alignment === 'adjacent' ||
    observation.scope.alignment === 'unclear' ||
    observation.scope.alignment === 'off_scope';

  const normalizedKnowledgePoints = knowledgePoints;
  const lessonPhase = current.lessonPhase ?? 'warmup';
  const activeKnowledgePointRef = current.activeKnowledgePointRef;

  const { activeKnowledgePointRef: _previousActiveKnowledgePointRef, ...currentWithoutActive } =
    current;
  void _previousActiveKnowledgePointRef;
  return {
    ...currentWithoutActive,
    ledgerVersion: current.ledgerVersion + 1,
    observedThroughMessageId: observation.sourceMessageIds.at(-1),
    sourceSnapshotHash: observation.sourceSnapshotHash,
    observationStatus: 'current',
    scopeStatus: needsReturn ? 'needs_return' : 'aligned',
    evidenceCheckpoint,
    lessonPhase,
    ...(activeKnowledgePointRef === undefined ? {} : { activeKnowledgePointRef }),
    comprehensiveCheck,
    closureInquiry,
    summaryStatus,
    knowledgePoints: normalizedKnowledgePoints,
    openLoops: openLoops.sort((left, right) => left.entryId.localeCompare(right.entryId)),
    explorationBranches: explorationBranches.sort((left, right) =>
      left.entryId.localeCompare(right.entryId),
    ),
    recentLearnerSignals: recentLearnerSignals
      .sort((left, right) => left.entryId.localeCompare(right.entryId))
      .slice(-20),
  };
}

export function reconcileTeachingObservations(
  current: TeachingStateSnapshot,
  observations: readonly TeachingObservation[],
  currentMessageIds: ReadonlySet<string>,
): Readonly<{
  changed: boolean;
  observations: readonly TeachingObservation[];
  state: TeachingStateSnapshot;
}> {
  const retractedObservationIds = new Set<string>();
  const reconciledObservations = observations.map((observation) => {
    if (
      observation.status !== 'active' ||
      observation.sourceMessageIds.every((messageId) => currentMessageIds.has(messageId))
    ) {
      return observation;
    }
    retractedObservationIds.add(observation.observationId);
    return { ...observation, status: 'retracted' as const };
  });
  if (retractedObservationIds.size === 0) {
    return { changed: false, observations, state: current };
  }

  let rebuilt = createTeachingState({
    lessonId: current.lessonId,
    sessionId: current.sessionId,
    knowledgePointRefs: current.knowledgePoints.map((point) => point.ref),
  });
  for (const observation of reconciledObservations) {
    rebuilt = reduceTeachingState(rebuilt, observation);
  }

  const currentByRef = new Map(current.knowledgePoints.map((point) => [point.ref, point]));
  const knowledgePoints = rebuilt.knowledgePoints.map((point) => {
    const control = currentByRef.get(point.ref);
    const difficultySignals = (control?.difficultySignals ?? []).filter((signal) =>
      currentMessageIds.has(signal.sourceMessageId),
    );
    return {
      ...point,
      progress: control?.progress ?? point.progress,
      interactionStatus: control?.interactionStatus ?? point.interactionStatus,
      difficultySignals,
      adaptiveDifficulty:
        difficultySignals.length >= 2 ? ('difficult' as const) : ('normal' as const),
      depthPreference: control?.depthPreference ?? 'default',
    };
  });
  const activeKnowledgePointRef = current.activeKnowledgePointRef;
  return {
    changed: true,
    observations: reconciledObservations,
    state: {
      ...rebuilt,
      ledgerVersion: current.ledgerVersion + 1,
      observationStatus: current.observationStatus,
      lessonPhase: current.lessonPhase,
      ...(activeKnowledgePointRef === undefined ? {} : { activeKnowledgePointRef }),
      comprehensiveCheck: current.comprehensiveCheck,
      closureInquiry: current.closureInquiry,
      summaryStatus: current.summaryStatus,
      knowledgePoints,
    },
  };
}
