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
  return {
    schemaVersion: 1,
    lessonId: input.lessonId,
    sessionId: input.sessionId,
    ledgerVersion: 0,
    sourceSnapshotHash: EMPTY_SNAPSHOT_HASH,
    observationStatus: 'current',
    scopeStatus: 'aligned',
    evidenceCheckpoint: false,
    knowledgePoints: unique(input.knowledgePointRefs).map((ref) => ({
      ref,
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
  const openLoops = current.openLoops.filter((loop) => !resolvedEntryRefs.has(loop.entryId));
  const explorationBranches = current.explorationBranches.map((branch) =>
    resolvedEntryRefs.has(branch.entryId) ? { ...branch, status: 'returned' as const } : branch,
  );
  const knowledgePoints = current.knowledgePoints.map((knowledgePoint) => ({
    ...knowledgePoint,
    unresolvedEntryRefs: knowledgePoint.unresolvedEntryRefs.filter(
      (entryRef) => !resolvedEntryRefs.has(entryRef),
    ),
  }));
  const recentLearnerSignals = [...current.recentLearnerSignals];
  let evidenceCheckpoint = current.evidenceCheckpoint;

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

  return {
    ...current,
    ledgerVersion: current.ledgerVersion + 1,
    observedThroughMessageId: observation.sourceMessageIds.at(-1),
    sourceSnapshotHash: observation.sourceSnapshotHash,
    observationStatus: 'current',
    scopeStatus: needsReturn ? 'needs_return' : 'aligned',
    evidenceCheckpoint,
    knowledgePoints,
    openLoops: openLoops.sort((left, right) => left.entryId.localeCompare(right.entryId)),
    explorationBranches: explorationBranches.sort((left, right) =>
      left.entryId.localeCompare(right.entryId),
    ),
    recentLearnerSignals: recentLearnerSignals
      .sort((left, right) => left.entryId.localeCompare(right.entryId))
      .slice(-20),
  };
}
