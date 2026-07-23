import { createHash } from 'node:crypto';

import type { UnitOfWork } from '../../../persistence/unit-of-work.js';
import { RepositoryVersionConflictError } from '../../../persistence/repository-errors.js';
import type {
  SemanticProfileCoreMerger,
  SemanticProfileObservation,
} from '../ports/semantic-profile-core-merger.js';
import type {
  SemanticProfileCoreRecord,
  SemanticProfileCoreRepository,
  SemanticProfileMode,
} from '../ports/semantic-profile-core-repository.js';

export type SemanticProfileSource = Readonly<{
  sourceId: string;
  sourceSnapshotHash: string;
  sourceGroupId: string;
  observations: readonly SemanticProfileObservation[];
}>;

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function normalize(value: string): string {
  return value.trim().normalize('NFKC').replace(/\s+/gu, ' ');
}

function receiptId(source: SemanticProfileSource): string {
  // A learning session may finalize or regenerate its Review more than once. The
  // cross-session core must count that session once, regardless of snapshot changes.
  return `semantic_profile_receipt_${sha256(source.sourceGroupId)}`;
}

function modeView(mode: SemanticProfileMode) {
  return {
    modeId: mode.modeId,
    origin: mode.origin,
    status: mode.status,
    feature: mode.feature,
    teachingImpact: mode.teachingImpact,
    applicabilityBoundary: mode.applicabilityBoundary,
    supportingSessionCount: mode.supportingSessionCount,
    priority: mode.priority,
  };
}

function validateSource(source: SemanticProfileSource): void {
  if (!/^[a-f0-9]{64}$/u.test(source.sourceSnapshotHash)) {
    throw new Error('semantic_profile_source_hash_invalid');
  }
  const ids = source.observations.map((item) => item.observationId);
  if (ids.length !== new Set(ids).size) throw new Error('semantic_profile_observation_duplicate');
}

function validateModeCopy(mode: {
  feature: string;
  teachingImpact: string;
  applicabilityBoundary: string;
  priority: number;
}): void {
  if (
    normalize(mode.feature).length === 0 ||
    normalize(mode.teachingImpact).length === 0 ||
    normalize(mode.applicabilityBoundary).length === 0
  ) {
    throw new Error('semantic_profile_mode_incomplete');
  }
  if (!Number.isInteger(mode.priority) || mode.priority < 1 || mode.priority > 5) {
    throw new Error('semantic_profile_mode_priority_invalid');
  }
}

function chooseModeId(sourceModeIds: readonly string[], origin: string, feature: string): string {
  return (
    sourceModeIds[0] ??
    `semantic_mode_${sha256(`${origin}:${normalize(feature).toLocaleLowerCase('zh-CN')}`).slice(0, 40)}`
  );
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim() !== ''))].sort();
}

function applyMerge(input: {
  current: SemanticProfileCoreRecord | undefined;
  source: SemanticProfileSource;
  mergerVersion: string;
  merged: Awaited<ReturnType<SemanticProfileCoreMerger['merge']>>;
  now: string;
}): SemanticProfileCoreRecord {
  const currentModes = new Map((input.current?.modes ?? []).map((mode) => [mode.modeId, mode]));
  const observations = new Map(
    input.source.observations.map((observation) => [observation.observationId, observation]),
  );
  const handled = new Set<string>();
  const consumedModes = new Set<string>();
  const replacements: SemanticProfileMode[] = [];

  for (const assignment of input.merged.assignments) {
    validateModeCopy(assignment.mode);
    if (assignment.observationIds.length === 0) {
      throw new Error('semantic_profile_assignment_empty');
    }
    const assignedObservations = assignment.observationIds.map((id) => {
      const observation = observations.get(id);
      if (observation === undefined || handled.has(id)) {
        throw new Error('semantic_profile_observation_assignment_invalid');
      }
      handled.add(id);
      return observation;
    });
    if (assignedObservations.some((item) => item.origin !== assignment.mode.origin)) {
      throw new Error('semantic_profile_origin_mixed');
    }
    const sourceModes = assignment.sourceModeIds.map((id) => {
      const mode = currentModes.get(id);
      if (mode === undefined || consumedModes.has(id)) {
        throw new Error('semantic_profile_source_mode_invalid');
      }
      consumedModes.add(id);
      return mode;
    });
    if (sourceModes.some((mode) => mode.origin !== assignment.mode.origin)) {
      throw new Error('semantic_profile_origin_mixed');
    }
    if (sourceModes.filter((mode) => mode.status === 'stable').length > 1) {
      throw new Error('semantic_profile_stable_merge_forbidden');
    }
    const sessionIncrement =
      assignment.mode.origin === 'observed_behavior'
        ? Math.max(1, ...assignedObservations.map((item) => item.supportingSessionCount ?? 1))
        : 0;
    const supportingSessionCount =
      sourceModes.reduce((total, mode) => total + mode.supportingSessionCount, 0) +
      sessionIncrement;
    const status =
      assignment.mode.origin === 'explicit_preference' || supportingSessionCount >= 2
        ? 'stable'
        : 'candidate';
    const evidenceIds = unique([
      ...sourceModes.flatMap((mode) => mode.representativeEvidenceIds),
      ...assignedObservations.flatMap((item) => item.evidenceIds),
    ]).slice(0, 3);
    const sourceRefs = unique([
      ...sourceModes.flatMap((mode) => mode.representativeSourceRefs),
      ...assignedObservations.flatMap((item) => item.sourceRefs),
    ]).slice(0, 6);
    const modeId = chooseModeId(
      sourceModes
        .sort((left, right) =>
          left.status === right.status ? 0 : left.status === 'stable' ? -1 : 1,
        )
        .map((mode) => mode.modeId),
      assignment.mode.origin,
      assignment.mode.feature,
    );
    const createdAt = sourceModes.map((mode) => mode.createdAt).sort()[0] ?? input.now;
    replacements.push({
      modeId,
      origin: assignment.mode.origin,
      status,
      feature: normalize(assignment.mode.feature),
      teachingImpact: normalize(assignment.mode.teachingImpact),
      applicabilityBoundary: normalize(assignment.mode.applicabilityBoundary),
      supportingSessionCount,
      representativeEvidenceIds: evidenceIds,
      representativeSourceRefs: sourceRefs,
      priority: assignment.mode.priority,
      createdAt,
      updatedAt: input.now,
    });
  }

  for (const ignored of input.merged.ignoredObservationIds) {
    if (!observations.has(ignored) || handled.has(ignored)) {
      throw new Error('semantic_profile_ignored_observation_invalid');
    }
    handled.add(ignored);
  }
  if (handled.size !== observations.size) throw new Error('semantic_profile_observation_unhandled');

  const modes = [
    ...(input.current?.modes ?? []).filter((mode) => !consumedModes.has(mode.modeId)),
    ...replacements,
  ];
  const normalizedFeatures = modes.map(
    (mode) => `${mode.origin}:${normalize(mode.feature).toLocaleLowerCase('zh-CN')}`,
  );
  if (normalizedFeatures.length !== new Set(normalizedFeatures).size) {
    throw new Error('semantic_profile_mode_duplicate');
  }
  const ordered = modes.sort(
    (left, right) =>
      (left.status === right.status ? 0 : left.status === 'stable' ? -1 : 1) ||
      right.priority - left.priority ||
      right.supportingSessionCount - left.supportingSessionCount ||
      left.modeId.localeCompare(right.modeId),
  );
  const stable = ordered.filter((mode) => mode.status === 'stable').slice(0, 5);
  const candidates = ordered.filter((mode) => mode.status === 'candidate').slice(0, 8);
  const nextModes = [...stable, ...candidates];
  const sourceSnapshotHash = sha256(
    JSON.stringify(
      nextModes.map((mode) => ({
        modeId: mode.modeId,
        origin: mode.origin,
        status: mode.status,
        feature: mode.feature,
        teachingImpact: mode.teachingImpact,
        applicabilityBoundary: mode.applicabilityBoundary,
        supportingSessionCount: mode.supportingSessionCount,
        representativeEvidenceIds: mode.representativeEvidenceIds,
        priority: mode.priority,
        createdAt: mode.createdAt,
        updatedAt: mode.updatedAt,
      })),
    ),
  );
  return {
    coreId: 'global_learning',
    schemaVersion: 1,
    mergerVersion: input.mergerVersion,
    sourceSnapshotHash,
    modes: nextModes,
    updatedAt: input.now,
    resourceVersion: input.current?.resourceVersion ?? 0,
  };
}

export function createCrossSessionSemanticCore(options: {
  repository: SemanticProfileCoreRepository;
  merger: SemanticProfileCoreMerger;
  unitOfWork: UnitOfWork;
  now(): Date;
  nextTransactionId(): string;
}) {
  let barrier: Promise<void> = Promise.resolve();

  async function perform(source: SemanticProfileSource): Promise<SemanticProfileCoreRecord> {
    validateSource(source);
    const id = receiptId(source);
    const existingReceipt = await options.repository.getReceipt(id);
    if (existingReceipt !== undefined) {
      const current = await options.repository.getCore();
      if (current === undefined) throw new Error('semantic_profile_receipt_without_core');
      return current;
    }
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = await options.repository.getCore();
      const merged = await options.merger.merge({
        currentModes: (current?.modes ?? []).map(modeView),
        observations: source.observations,
      });
      const now = options.now().toISOString();
      const next = applyMerge({
        current,
        source,
        mergerVersion: options.merger.version,
        merged,
        now,
      });
      try {
        await options.unitOfWork.execute(
          { transactionId: options.nextTransactionId() },
          async (tx) => {
            if ((await options.repository.getReceipt(id)) !== undefined) return;
            await options.repository.saveCore(tx, next, current?.resourceVersion ?? 0);
            await options.repository.saveReceipt(tx, {
              receiptId: id,
              sourceId: source.sourceId,
              sourceSnapshotHash: source.sourceSnapshotHash,
              sourceGroupId: source.sourceGroupId,
              appliedModeIds: next.modes
                .filter((mode) => mode.updatedAt === now)
                .map((mode) => mode.modeId),
              createdAt: now,
            });
          },
        );
        return (await options.repository.getCore()) ?? next;
      } catch (error) {
        if (error instanceof RepositoryVersionConflictError && attempt < 2) continue;
        throw error;
      }
    }
    throw new Error('semantic_profile_core_conflict');
  }

  function ingest(source: SemanticProfileSource): Promise<SemanticProfileCoreRecord> {
    const result = barrier.then(() => perform(source));
    barrier = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  return {
    ingest,
    bootstrap: ingest,
    getCurrent: () => options.repository.getCore(),
  };
}
