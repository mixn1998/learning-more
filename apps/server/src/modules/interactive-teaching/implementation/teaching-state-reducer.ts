import type {
  TeachingObservation,
  TeachingObservationEntry,
  TeachingStateSnapshot,
} from '@learning-more/contracts';

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
      delivery: 'not_addressed',
      verification: 'not_observed',
      teachingEvidenceRefs: [],
      learnerEvidenceRefs: [],
      unresolvedEntryRefs: [],
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
  const currentByRef = new Map(current.knowledgePoints.map((point) => [point.ref, point]));
  const knowledgePoints = baseline.knowledgePoints.map(
    (point) => currentByRef.get(point.ref) ?? point,
  );
  const activeStillExists = knowledgePoints.some(
    (point) => point.ref === current.activeKnowledgePointRef,
  );
  const activeKnowledgePointRef = activeStillExists
    ? current.activeKnowledgePointRef
    : knowledgePoints.find((point) => point.progress !== 'passed' && point.progress !== 'skipped')
        ?.ref;
  const { activeKnowledgePointRef: _previousActiveKnowledgePointRef, ...currentWithoutActive } =
    current;
  void _previousActiveKnowledgePointRef;
  const comprehensiveCheck = current.comprehensiveCheck ?? 'pending';
  const closureInquiry =
    current.closureInquiry ??
    (current.lessonPhase === 'ready_to_close'
      ? 'confirmed_no_questions'
      : comprehensiveCheck === 'passed' || comprehensiveCheck === 'skipped'
        ? 'awaiting_confirmation'
        : 'pending');
  return {
    ...currentWithoutActive,
    lessonPhase: current.lessonPhase ?? 'warmup',
    comprehensiveCheck,
    closureInquiry,
    summaryStatus:
      closureInquiry === 'confirmed_no_questions'
        ? (current.summaryStatus ?? 'pending')
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
    progress:
      knowledgePoint.progress ??
      (knowledgePoint.verification === 'supporting'
        ? ('passed' as const)
        : knowledgePoint.delivery === 'explained'
          ? ('checking' as const)
          : ('pending' as const)),
    unresolvedEntryRefs: knowledgePoint.unresolvedEntryRefs.filter(
      (entryRef) => !resolvedEntryRefs.has(entryRef),
    ),
  }));
  const recentLearnerSignals = [...current.recentLearnerSignals];
  let evidenceCheckpoint = current.evidenceCheckpoint;
  let comprehensiveCheck = current.comprehensiveCheck ?? 'pending';
  let closureInquiry =
    current.closureInquiry ??
    (current.lessonPhase === 'ready_to_close'
      ? 'confirmed_no_questions'
      : comprehensiveCheck === 'passed' || comprehensiveCheck === 'skipped'
        ? 'awaiting_confirmation'
        : 'pending');
  let summaryStatus =
    closureInquiry === 'confirmed_no_questions' ? (current.summaryStatus ?? 'pending') : 'pending';

  for (const entry of observation.entries) {
    if (entry.progressionSignal === 'pass_comprehensive_check') {
      comprehensiveCheck = 'passed';
    }
    if (entry.progressionSignal === 'skip_comprehensive_check') {
      comprehensiveCheck = 'skipped';
    }
  }
  if (comprehensiveCheck === 'passed' || comprehensiveCheck === 'skipped') {
    if (
      observation.entries.some(
        (entry) => entry.progressionSignal === 'confirm_no_further_questions',
      )
    ) {
      closureInquiry = 'confirmed_no_questions';
    } else if (closureInquiry === 'pending') {
      closureInquiry = 'awaiting_confirmation';
    }
  }

  for (const entry of observation.entries) {
    if (establishesCheckpoint(observation, entry)) evidenceCheckpoint = true;

    if (entry.kind === 'open_loop') {
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
            progress: 'checking',
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
    if (entry.progressionSignal === 'skip_knowledge_point') {
      const targetRefs =
        entry.knowledgePointRefs.length > 0
          ? entry.knowledgePointRefs
          : current.activeKnowledgePointRef === undefined
            ? []
            : [current.activeKnowledgePointRef];
      for (const ref of targetRefs) {
        const index = knowledgePoints.findIndex((item) => item.ref === ref);
        const point = knowledgePoints[index];
        if (index !== -1 && point !== undefined) {
          knowledgePoints[index] = { ...point, progress: 'skipped' };
        }
      }
    }
    if (
      entry.progressionSignal === 'lesson_summary_delivered' &&
      closureInquiry === 'confirmed_no_questions'
    ) {
      summaryStatus = 'delivered';
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

  const normalizedKnowledgePoints = knowledgePoints.map((point) => {
    if (point.progress === 'skipped' || point.progress === 'passed') return point;
    if (point.delivery !== 'explained') return { ...point, progress: 'pending' as const };
    if (point.unresolvedEntryRefs.length > 0) {
      return { ...point, progress: 'checking' as const };
    }
    return {
      ...point,
      progress: point.verification === 'supporting' ? ('passed' as const) : ('checking' as const),
    };
  });
  const comprehensiveCheckSettled =
    comprehensiveCheck === 'passed' || comprehensiveCheck === 'skipped';
  const unsettledKnowledgePoint = normalizedKnowledgePoints.find(
    (point) =>
      (point.progress !== 'passed' && point.progress !== 'skipped') ||
      (!comprehensiveCheckSettled && point.unresolvedEntryRefs.length > 0),
  );
  const mayAdvanceWarmup =
    (observation.scope.alignment === 'direct' || observation.scope.alignment === 'supporting') &&
    observation.entries.some((entry) =>
      [
        'learner_demonstration',
        'learner_question',
        'learner_intent',
        'learner_reasoning_behavior',
      ].includes(entry.kind),
    );
  let lessonPhase = current.lessonPhase ?? 'warmup';
  let activeKnowledgePointRef = current.activeKnowledgePointRef;
  if (unsettledKnowledgePoint !== undefined) {
    if (lessonPhase !== 'warmup' || mayAdvanceWarmup) lessonPhase = 'knowledge_point';
    activeKnowledgePointRef = unsettledKnowledgePoint.ref;
  } else if (comprehensiveCheck === 'pending' || comprehensiveCheck === 'checking') {
    lessonPhase = 'comprehensive_check';
    comprehensiveCheck = 'checking';
    activeKnowledgePointRef = undefined;
  } else if (
    openLoops.length > 0 ||
    closureInquiry !== 'confirmed_no_questions' ||
    summaryStatus !== 'delivered'
  ) {
    lessonPhase = 'summary';
    activeKnowledgePointRef = undefined;
  } else {
    lessonPhase = 'ready_to_close';
    activeKnowledgePointRef = undefined;
  }

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
