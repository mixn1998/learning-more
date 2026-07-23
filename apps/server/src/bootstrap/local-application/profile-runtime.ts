import { createHash, randomUUID } from 'node:crypto';

import type { PortraitRouteOptions } from '../../http/routes/portraits.js';
import type { ProfileRouteOptions } from '../../http/routes/profile.js';
import { createGenerationReasoningBehaviorAnalyzer } from '../../modules/global-user-profile/implementation/generation-reasoning-behavior-analyzer.js';
import { createGenerationSemanticProfileCoreMerger } from '../../modules/global-user-profile/implementation/generation-semantic-profile-core-merger.js';
import {
  createPersonalizationDigestSource,
  renderPersonalizationDigest,
} from '../../modules/global-user-profile/implementation/personalization-digest.js';
import { createReasoningBehaviorModule } from '../../modules/global-user-profile/implementation/reasoning-behavior-module.js';
import { createCrossSessionSemanticCore } from '../../modules/global-user-profile/implementation/semantic-profile-core.js';
import type { ReasoningBehaviorAnalysisRecord } from '../../modules/global-user-profile/ports/reasoning-behavior-repository.js';
import type { TeachingContextSources } from '../../modules/interactive-teaching/ports/teaching-context-sources.js';
import { packPortraitEvidence } from '../../modules/learning-portrait/implementation/evidence-packer.js';
import { createPortraitModule } from '../../modules/learning-portrait/implementation/portrait-module.js';
import { createPortraitRefreshCoordinator } from '../../modules/learning-portrait/implementation/portrait-refresh-coordinator.js';
import { createWeeklyPortraitScheduler } from '../../modules/learning-portrait/implementation/weekly-portrait-scheduler.js';
import { createAiProfileEvidenceExtractor } from '../../modules/profile-evidence/implementation/ai-profile-evidence-extractor.js';
import type { CandidateEvidence } from '../../modules/profile-evidence/interface.js';
import { createProfileEvidenceAggregator } from '../../modules/profile-evidence/implementation/profile-evidence-aggregator.js';
import { assembleProfileEvidenceContext } from '../../modules/profile-evidence/implementation/profile-evidence-context-assembler.js';
import { purgeDeprecatedReasoningEvidence } from '../../modules/profile-evidence/implementation/deprecated-reasoning-evidence-migration.js';
import { createProfileEvidencePipeline } from '../../modules/profile-evidence/implementation/pipeline.js';
import { reasoningEvidenceSummaryForRead } from '../../modules/profile-evidence/implementation/reasoning-evidence-summary.js';
import { queryGlobalLearningProfile } from '../../modules/profile-evidence/implementation/profile-query.js';
import { createReasoningEvidenceProjector } from '../../modules/profile-evidence/implementation/reasoning-evidence-projector.js';
import type { DataRoot } from '../../persistence/data-root.js';
import { createLocalFilePortraitRepository } from '../../persistence/portrait-repositories.js';
import { createLocalFilePersonalizationDigestRepository } from '../../persistence/personalization-digest-repositories.js';
import { createLocalFileEvidenceRepositories } from '../../persistence/profile-evidence-repositories.js';
import { createLocalFileReasoningBehaviorRepository } from '../../persistence/reasoning-behavior-repositories.js';
import { createLocalFileSemanticProfileCoreRepository } from '../../persistence/semantic-profile-core-repositories.js';
import { RepositoryVersionConflictError } from '../../persistence/repository-errors.js';
import type { UnitOfWork } from '../../persistence/unit-of-work.js';
import type { StructuredLogInput } from '../../runtime/logger.js';
import type { LocalEventFactsRuntime } from './event-facts-runtime.js';
import {
  createProfileEvidenceCheckpointRecovery,
  PROFILE_EVIDENCE_EXTRACTOR_VERSION,
} from './profile-evidence-checkpoint-recovery.js';
import type { LocalGenerationRuntime } from './generation-runtime.js';

function parseStructuredJson(markdown: string): unknown {
  const trimmed = markdown.trim();
  const fenced = /^```(?:json)?\s*\r?\n([\s\S]*?)\r?\n```$/u.exec(trimmed);
  return JSON.parse((fenced?.[1] ?? trimmed).trim()) as unknown;
}

export type LocalProfileRuntime = Readonly<{
  checkpointSink: Readonly<{ capture(input: unknown): Promise<void> }>;
  reasoningBehaviorSink: ReturnType<typeof createReasoningBehaviorModule>;
  profileRoutes: ProfileRouteOptions;
  portraitRoutes: PortraitRouteOptions;
  requestPortraitRefresh: PortraitRouteOptions['requestRefresh'];
  getTeachingPersonalization: TeachingContextSources['getPersonalizationView'];
  refreshPersonalizationDigest(): Promise<void>;
  recoverReasoningAnalysis(): Promise<void>;
  getProjectionStatus(): 'ready' | 'degraded';
  start(): void;
  close(): Promise<void>;
}>;

export function createLocalProfileRuntime(
  input: Readonly<{
    dataRoot: DataRoot;
    unitOfWork: UnitOfWork;
    now: () => Date;
    generation: LocalGenerationRuntime;
    events: LocalEventFactsRuntime;
    logProjectionEvent?: (input: StructuredLogInput) => Promise<void>;
  }>,
): LocalProfileRuntime {
  const evidenceRepositories = createLocalFileEvidenceRepositories(input.dataRoot);
  const reasoningBehaviorRepository = createLocalFileReasoningBehaviorRepository(input.dataRoot);
  const portraitRepository = createLocalFilePortraitRepository(input.dataRoot);
  const personalizationDigestRepository = createLocalFilePersonalizationDigestRepository(
    input.dataRoot,
  );
  const semanticProfileCoreRepository = createLocalFileSemanticProfileCoreRepository(
    input.dataRoot,
  );
  const semanticProfileCore = createCrossSessionSemanticCore({
    repository: semanticProfileCoreRepository,
    merger: createGenerationSemanticProfileCoreMerger({
      runtime: input.generation.runtime,
      execution: input.generation.execution,
      providerId: 'current',
      mergerVersion: 'semantic-profile-core-merger@1',
    }),
    unitOfWork: input.unitOfWork,
    now: input.now,
    nextTransactionId: () => `tx_semantic_profile_${randomUUID()}`,
  });
  const reasoningBehaviorModule = createReasoningBehaviorModule({
    repository: reasoningBehaviorRepository,
    unitOfWork: input.unitOfWork,
    analyzer: createGenerationReasoningBehaviorAnalyzer({
      runtime: input.generation.runtime,
      execution: input.generation.execution,
      providerId: 'current',
      analyzerVersion: 'reasoning-global-analyzer@2',
    }),
    now: input.now,
    nextTransactionId: () => `tx_reasoning_${randomUUID()}`,
  });
  const reasoningEvidenceProjector = createReasoningEvidenceProjector({
    reasoningRepository: reasoningBehaviorRepository,
    evidenceRepositories,
    unitOfWork: input.unitOfWork,
    now: input.now,
    nextTransactionId: () => `tx_reasoning_evidence_${randomUUID()}`,
  });
  const profileEvidenceExtractor = createAiProfileEvidenceExtractor({
    runtime: input.generation.runtime,
    execution: input.generation.execution,
    providerId: 'current',
    analyzerVersion: 'profile-evidence-analyzer@2',
    extractorVersion: PROFILE_EVIDENCE_EXTRACTOR_VERSION,
    now: input.now,
  });
  const profileEvidenceAggregator = createProfileEvidenceAggregator({
    repositories: evidenceRepositories,
    unitOfWork: input.unitOfWork,
    now: input.now,
    nextTransactionId: () => `tx_profile_evidence_${randomUUID()}`,
  });
  let profileEvidenceBarrier: Promise<void> = Promise.resolve();
  let projectionStatus: 'ready' | 'degraded' = 'ready';
  const checkpointRecovery = createProfileEvidenceCheckpointRecovery({
    reasoning: reasoningBehaviorRepository,
    evidence: evidenceRepositories,
    unitOfWork: input.unitOfWork,
  });

  async function enqueueProfileEvidenceCheckpoint(checkpoint: unknown): Promise<void> {
    const queued = profileEvidenceBarrier.then(async () => {
      if (typeof checkpoint !== 'object' || checkpoint === null || Array.isArray(checkpoint)) {
        throw new Error('profile_checkpoint_invalid');
      }
      const existingCandidates = [];
      for await (const candidate of evidenceRepositories.evidence.list()) {
        if (candidate.status !== 'active' || candidate.governance === undefined) continue;
        existingCandidates.push({
          evidenceId: candidate.evidenceId,
          semanticKey: candidate.governance.semanticKey,
          claimDimension: candidate.claimDimension,
          summary: candidate.summary,
          sourceGroupId: candidate.sourceGroupId,
        });
      }
      const enrichedCheckpoint = await checkpointRecovery.enrichReviewCheckpoint(
        checkpoint as Record<string, unknown>,
      );
      const checkpointInput = {
        ...enrichedCheckpoint,
        existingCandidates,
      };
      const context = assembleProfileEvidenceContext(checkpointInput);
      if (await checkpointRecovery.isCompleted(context)) return;
      const extracted = await profileEvidenceExtractor.extract(context.checkpoint);
      await profileEvidenceAggregator.ingest(extracted);
      const sessionSource = extracted.checkpoint.dependentSourceGroupIds
        .map((sourceGroupId) => /^lesson:([^:]+):session:(.+)$/u.exec(sourceGroupId))
        .find((match): match is RegExpExecArray => match !== null);
      let projectedCandidateCount = extracted.candidates.length;
      if (
        extracted.checkpoint.checkpointKind === 'authoring_candidate_confirmed' &&
        extracted.checkpoint.courseId !== undefined &&
        extracted.checkpoint.courseMode !== undefined
      ) {
        await reasoningBehaviorModule.captureFromConfirmedAuthoring({
          courseId: extracted.checkpoint.courseId,
          courseMode: extracted.checkpoint.courseMode,
          checkpointId: extracted.checkpoint.checkpointId,
          sourceGroupId: extracted.checkpoint.sourceGroupId,
          sourceSnapshotHash: extracted.sourceSnapshotHash,
          extractedAt: extracted.extractedAt,
          sources: extracted.checkpoint.sources.map((source) => ({
            sourceRef: source.sourceRef,
            role: source.role === 'user' ? 'user' : 'assistant',
            observedAt: source.observedAt,
          })),
          candidates: extracted.candidates,
        });
      }
      if (
        (extracted.checkpoint.checkpointKind === 'stage_review_finalized' ||
          extracted.checkpoint.checkpointKind === 'lesson_review_finalized') &&
        extracted.checkpoint.courseId !== undefined &&
        extracted.checkpoint.courseMode !== undefined
      ) {
        if (sessionSource !== undefined) {
          projectedCandidateCount = extracted.candidates.filter(
            (candidate) =>
              candidate.candidateKind === 'thinking_behavior' &&
              candidate.safetyStatus !== 'blocked',
          ).length;
          await reasoningBehaviorModule.captureFromReview({
            courseId: extracted.checkpoint.courseId,
            courseMode: extracted.checkpoint.courseMode,
            lessonId: sessionSource[1]!,
            sessionId: sessionSource[2]!,
            checkpointId: extracted.checkpoint.checkpointId,
            sourceSnapshotHash: extracted.sourceSnapshotHash,
            extractedAt: extracted.extractedAt,
            observedAt: extracted.checkpoint.sources
              .map((source) => source.observedAt)
              .sort()
              .at(-1)!,
            candidates: extracted.candidates,
          });
        }
      }
      const isFinalLessonReview =
        extracted.checkpoint.checkpointKind === 'lesson_review_finalized' &&
        sessionSource !== undefined;
      const semanticCandidates = extracted.candidates.filter(
        (candidate) =>
          candidate.safetyStatus !== 'blocked' &&
          ((isFinalLessonReview && candidate.candidateKind === 'thinking_behavior') ||
            (candidate.candidateKind === 'durable_preference' &&
              candidate.explicitness === 'user_declared' &&
              candidate.expiryPolicy.kind === 'until_corrected')),
      );
      if (semanticCandidates.length > 0) {
        const evidenceByKey = new Map<string, string[]>();
        for await (const evidence of evidenceRepositories.evidence.list()) {
          const governance = evidence.governance;
          if (
            evidence.status !== 'active' ||
            governance === undefined ||
            !governance.checkpointIds.includes(extracted.checkpoint.checkpointId)
          ) {
            continue;
          }
          const key = `${governance.candidateKind}:${evidence.claimDimension}:${governance.label}`;
          evidenceByKey.set(key, [...(evidenceByKey.get(key) ?? []), evidence.evidenceId]);
        }
        await semanticProfileCore.ingest({
          sourceId: extracted.checkpoint.checkpointId,
          sourceSnapshotHash: extracted.sourceSnapshotHash,
          sourceGroupId:
            isFinalLessonReview && sessionSource !== undefined
              ? `session:${sessionSource[2]}`
              : extracted.checkpoint.sourceGroupId,
          observations: semanticCandidates.map((candidate) => ({
            observationId: `semantic_observation_${createHash('sha256')
              .update(
                JSON.stringify({
                  checkpointId: extracted.checkpoint.checkpointId,
                  candidateKind: candidate.candidateKind,
                  claimDimension: candidate.claimDimension,
                  label: candidate.label,
                  sourceRefs: candidate.sourceRefs,
                }),
              )
              .digest('hex')
              .slice(0, 40)}`,
            origin:
              candidate.candidateKind === 'durable_preference'
                ? ('explicit_preference' as const)
                : ('observed_behavior' as const),
            summary: `${candidate.label}：${candidate.summary}`,
            evidenceIds:
              evidenceByKey.get(
                `${candidate.candidateKind}:${candidate.claimDimension}:${candidate.label}`,
              ) ?? [],
            sourceRefs: candidate.sourceRefs,
          })),
        });
      }
      await checkpointRecovery.markCompleted({
        checkpointId: extracted.checkpoint.checkpointId,
        sourceType: extracted.checkpoint.sourceType,
        sourceSnapshotHash: extracted.sourceSnapshotHash,
        projectedCandidateCount,
        ignoredCandidateCount: extracted.candidates.length - projectedCandidateCount,
        updatedAt: extracted.extractedAt,
      });
      if (semanticCandidates.length > 0) schedulePersonalizationDigestRefresh();
      projectionStatus = 'ready';
    });
    profileEvidenceBarrier = queued.catch(() => {
      projectionStatus = 'degraded';
    });
    await profileEvidenceBarrier;
  }

  async function latestUsableReasoningAnalysis() {
    let latest: ReasoningBehaviorAnalysisRecord | undefined;
    for await (const analysis of reasoningBehaviorRepository.listAnalyses()) {
      if (
        analysis.snapshot.status !== 'usable' ||
        analysis.snapshot.analyzerVersion !== 'reasoning-global-analyzer@2'
      ) {
        continue;
      }
      const filter = analysis.snapshot.filter;
      if (
        filter.windowStart !== undefined ||
        filter.windowEnd !== undefined ||
        filter.courseIds.length > 0 ||
        filter.lessonIds.length > 0 ||
        filter.courseModes.length > 0 ||
        filter.elicitations.length > 0
      ) {
        continue;
      }
      if (latest === undefined || analysis.snapshot.createdAt > latest.snapshot.createdAt) {
        latest = analysis;
      }
    }
    return latest;
  }

  async function collectPersonalizationDigestSource() {
    const core = await semanticProfileCore.getCurrent();
    return createPersonalizationDigestSource({
      profileVersion: core?.resourceVersion ?? 0,
      items: (core?.modes ?? [])
        .filter((mode) => mode.status === 'stable')
        .map((mode) => ({
          sourceId: mode.modeId,
          kind:
            mode.origin === 'explicit_preference'
              ? ('durable_preference' as const)
              : ('stable_dimension' as const),
          summary: mode.feature,
          teachingImpact: mode.teachingImpact,
          priority: mode.priority,
          supportingSessionCount: mode.supportingSessionCount,
          sourceRefs: [...mode.representativeSourceRefs],
        })),
    });
  }

  async function updatePersonalizationDigest(
    transactionPrefix: string,
    update: (
      current: Awaited<ReturnType<typeof personalizationDigestRepository.get>>,
    ) =>
      | Exclude<Awaited<ReturnType<typeof personalizationDigestRepository.get>>, undefined>
      | undefined,
  ): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = await personalizationDigestRepository.get();
      const next = update(current);
      if (next === undefined) return;
      try {
        await input.unitOfWork.execute(
          { transactionId: `${transactionPrefix}_${randomUUID()}` },
          (tx) => personalizationDigestRepository.save(tx, next, current?.resourceVersion ?? 0),
        );
        return;
      } catch (error) {
        if (error instanceof RepositoryVersionConflictError && attempt < 2) continue;
        throw error;
      }
    }
  }

  let personalizationDigestBarrier: Promise<void> = Promise.resolve();
  async function performPersonalizationDigestRefresh(): Promise<void> {
    await bootstrapSemanticProfileCore();
    const source = await collectPersonalizationDigestSource();
    const before = await personalizationDigestRepository.get();
    if (
      before?.refreshStatus === 'succeeded' &&
      before.latestSuccessful?.projectionVersion === 'semantic-profile-digest@1' &&
      before.requestedProfileVersion === source.profileVersion &&
      before.requestedSourceSnapshotHash === source.sourceSnapshotHash
    ) {
      return;
    }
    await updatePersonalizationDigest('tx_personalization_digest_pending', (current) => ({
      digestId: 'interactive_teaching',
      resourceVersion: current?.resourceVersion ?? 0,
      requestedProfileVersion: source.profileVersion,
      requestedSourceSnapshotHash: source.sourceSnapshotHash,
      refreshStatus: 'pending',
      ...(current?.latestSuccessful === undefined
        ? {}
        : { latestSuccessful: current.latestSuccessful }),
      updatedAt: input.now().toISOString(),
    }));
    try {
      const projection = renderPersonalizationDigest(source);
      await updatePersonalizationDigest('tx_personalization_digest_ready', (current) => {
        if (
          current === undefined ||
          current.requestedSourceSnapshotHash !== source.sourceSnapshotHash
        ) {
          return undefined;
        }
        return {
          ...current,
          refreshStatus: 'succeeded',
          latestSuccessful: {
            projectionVersion: 'semantic-profile-digest@1',
            profileVersion: source.profileVersion,
            sourceSnapshotHash: source.sourceSnapshotHash,
            summary: projection.summary,
            selectedModeIds: projection.selectedModeIds,
            sourceRefs: source.items
              .filter((item) => projection.selectedModeIds.includes(item.sourceId))
              .flatMap((item) => item.sourceRefs),
            generatedAt: input.now().toISOString(),
          },
          updatedAt: input.now().toISOString(),
        };
      });
    } catch (error) {
      await updatePersonalizationDigest('tx_personalization_digest_failed', (current) => {
        if (
          current === undefined ||
          current.requestedSourceSnapshotHash !== source.sourceSnapshotHash
        ) {
          return undefined;
        }
        return {
          ...current,
          refreshStatus: 'failed',
          lastError:
            error instanceof Error ? error.message : 'personalization_digest_refresh_failed',
          updatedAt: input.now().toISOString(),
        };
      });
      throw error;
    }
  }

  function refreshPersonalizationDigest(): Promise<void> {
    const queued = personalizationDigestBarrier.then(performPersonalizationDigestRefresh);
    personalizationDigestBarrier = queued.catch((error) => {
      void input
        .logProjectionEvent?.({
          level: 'error',
          component: 'PersonalizationDigestProjection',
          correlationId: 'refresh_personalization_digest',
          eventCode: 'personalization_digest_refresh_failed',
          fields: { error },
        })
        .catch(() => undefined);
    });
    return personalizationDigestBarrier;
  }

  function schedulePersonalizationDigestRefresh(): void {
    void refreshPersonalizationDigest();
  }

  async function refreshAndProjectReasoningAnalysis(
    filter?: Parameters<typeof reasoningBehaviorModule.refreshAnalysis>[0],
  ) {
    const analysis = await reasoningBehaviorModule.refreshAnalysis(filter);
    if (analysis !== undefined) await reasoningEvidenceProjector.project(analysis);
    return analysis;
  }

  async function recoverReasoningAnalysis(): Promise<void> {
    try {
      const referencedEvidenceIds = new Set<string>();
      for await (const manifest of portraitRepository.listManifests()) {
        for (const evidenceId of manifest.includedEvidenceIds) {
          referencedEvidenceIds.add(evidenceId);
        }
      }
      await purgeDeprecatedReasoningEvidence({
        evidenceRepository: evidenceRepositories.evidence,
        referencedEvidenceIds,
        unitOfWork: input.unitOfWork,
        nextTransactionId: () => `tx_reasoning_evidence_migration_${randomUUID()}`,
      });
      const analysis = await refreshAndProjectReasoningAnalysis();
      if (analysis !== undefined) projectionStatus = 'ready';
      await refreshPersonalizationDigest();
    } catch (error) {
      projectionStatus = 'degraded';
      await input
        .logProjectionEvent?.({
          level: 'error',
          component: 'ProfileProjectionRecovery',
          correlationId: 'recover_reasoning_analysis',
          eventCode: 'profile_projection_recovery_failed',
          fields: { error },
        })
        .catch(() => undefined);
    }
  }

  let semanticCoreBootstrapBarrier: Promise<void> | undefined;
  function bootstrapSemanticProfileCore(): Promise<void> {
    semanticCoreBootstrapBarrier ??= (async () => {
      if ((await semanticProfileCore.getCurrent()) !== undefined) return;
      const reasoning = await latestUsableReasoningAnalysis();
      const stableCounts = new Map(
        (reasoning?.snapshot.dimensions ?? []).map((item) => [
          item.dimensionId,
          item.independentSourceGroupCount,
        ]),
      );
      const evidence: CandidateEvidence[] = [];
      for await (const candidate of evidenceRepositories.evidence.list()) {
        if (candidate.status === 'active') evidence.push(candidate);
      }
      const observations = [
        ...(reasoning?.dimensions ?? []).map((dimension) => ({
          observationId: `semantic_bootstrap_${dimension.dimensionId}`,
          origin: 'observed_behavior' as const,
          summary: `${dimension.label}：${dimension.description}`,
          evidenceIds: evidence
            .filter(
              (candidate) =>
                candidate.summary.startsWith(`${dimension.label}：`) &&
                candidate.sourceGroup === 'behavior',
            )
            .map((candidate) => candidate.evidenceId)
            .slice(0, 3),
          supportingSessionCount: stableCounts.get(dimension.dimensionId) ?? 1,
          sourceRefs: dimension.derivedFromEpisodeIds.map(
            (episodeId) => `reasoning-episode:${episodeId}`,
          ),
        })),
        ...evidence
          .filter(
            (candidate) =>
              candidate.governance?.candidateKind === 'durable_preference' &&
              candidate.governance.explicitness === 'user_declared' &&
              candidate.governance.safetyStatus !== 'blocked' &&
              candidate.governance.expiryPolicy.kind === 'until_corrected',
          )
          .map((candidate) => ({
            observationId: `semantic_bootstrap_${candidate.evidenceId}`,
            origin: 'explicit_preference' as const,
            summary: `${candidate.governance!.label}：${candidate.summary}`,
            evidenceIds: [candidate.evidenceId],
            sourceRefs: [...candidate.sourceRefs],
          })),
      ];
      if (observations.length === 0) return;
      const sourceSnapshotHash = createHash('sha256')
        .update(JSON.stringify(observations))
        .digest('hex');
      await semanticProfileCore.bootstrap({
        sourceId: 'semantic-profile-core-bootstrap@1',
        sourceSnapshotHash,
        sourceGroupId: 'migration:legacy-global-profile',
        observations,
      });
    })().finally(() => {
      semanticCoreBootstrapBarrier = undefined;
    });
    return semanticCoreBootstrapBarrier;
  }

  const evidencePipeline = createProfileEvidencePipeline({
    factRepository: input.events.factRepository,
    repositories: evidenceRepositories,
    unitOfWork: input.unitOfWork,
    extractorVersion: 'facts@2',
    now: input.now,
    nextTransactionId: () => `tx_evidence_${randomUUID()}`,
  });
  let evidenceBarrier: Promise<void> = Promise.resolve();
  async function syncProfileEvidence(): Promise<void> {
    const synchronization = evidenceBarrier.then(async () => {
      await input.events.flush();
      let batch;
      do {
        batch = await evidencePipeline.processFacts({ limit: 100 });
      } while (batch.processed > 0);
    });
    evidenceBarrier = synchronization.catch(() => undefined);
    await synchronization;
  }

  function globalProfileWindow() {
    return {
      from: '1970-01-01T00:00:00.000Z',
      to: new Date(input.now().getTime() + 86_400_000).toISOString(),
    };
  }

  async function globalProfile() {
    await syncProfileEvidence();
    return queryGlobalLearningProfile({
      factRepository: input.events.factRepository,
      evidenceRepository: evidenceRepositories.evidence,
      timeZone: 'Asia/Shanghai',
      window: globalProfileWindow(),
    });
  }

  const portraitModule = createPortraitModule({
    repository: portraitRepository,
    evidenceRepository: evidenceRepositories.evidence,
    unitOfWork: input.unitOfWork,
    generationRuntime: input.generation.runtime,
    providerId: 'current',
    nextVersionId: () => `portrait_${randomUUID()}`,
    nextTransactionId: () => `tx_portrait_${randomUUID()}`,
    now: input.now,
    async recordCreated(event, tx) {
      const eventId = `event_${randomUUID()}`;
      const timestamp = input.now().toISOString();
      await input.events.outbox.enqueue(tx, [
        {
          id: eventId,
          schema_version: 1,
          type: 'PortraitVersionCommitted',
          occurred_at: timestamp,
          recorded_at: timestamp,
          source: 'LearningPortrait',
          target_refs: { portraitVersionId: event.versionId },
          payload: { manifestId: event.manifestId },
          idempotency_key: `portrait-version:${event.versionId}`,
          correlation_id: eventId,
        },
      ]);
    },
  });

  async function performPortraitRefresh(inputRequest: {
    idempotencyKey: string;
    tokenBudget: number;
  }) {
    await profileEvidenceBarrier;
    await profileEvidenceAggregator.expire();
    await bootstrapSemanticProfileCore();
    const [profile, semanticCore] = await Promise.all([
      globalProfile(),
      semanticProfileCore.getCurrent(),
    ]);
    const stableModes = (semanticCore?.modes ?? []).filter(
      (mode) =>
        mode.status === 'stable' &&
        mode.origin === 'observed_behavior' &&
        mode.supportingSessionCount >= 2 &&
        mode.representativeEvidenceIds.length >= 2,
    );
    const stableEvidenceIds = stableModes.flatMap((mode) => mode.representativeEvidenceIds);
    const candidates = [];
    for await (const candidate of evidenceRepositories.evidence.list()) candidates.push(candidate);
    const packedEvidence = packPortraitEvidence({
      evidence: candidates,
      tokenBudget: inputRequest.tokenBudget,
      dimensionPriority: [],
      stableEvidenceIds,
    });
    const includedEvidenceIds = new Set(packedEvidence.includedEvidenceIds);
    const portraitModes = stableModes
      .map((mode) => ({
        modeId: mode.modeId,
        feature: mode.feature,
        teachingImpact: mode.teachingImpact,
        applicabilityBoundary: mode.applicabilityBoundary,
        evidenceSessionCount: mode.supportingSessionCount,
        evidenceIds: mode.representativeEvidenceIds.filter((id) => includedEvidenceIds.has(id)),
      }))
      .filter((mode) => mode.evidenceIds.length >= 2);
    const requested = await portraitModule.requestRefresh({
      profileVersion: profile.profileSchemaVersion,
      packedEvidence,
      window: profile.window,
      promptTemplateVersion: 'portrait-semantic-core@1',
      providerConfigFingerprint: createHash('sha256').update('mock').digest('hex'),
      ...(semanticCore === undefined
        ? {}
        : {
            semanticCoreInput: {
              sourceSnapshotHash: semanticCore.sourceSnapshotHash,
              modes: portraitModes,
            },
          }),
      idempotencyKey: inputRequest.idempotencyKey,
    });
    if (requested.state === 'completed' || requested.state === 'failed') return requested;
    if (requested.generationTaskId === undefined) return requested;
    const task = await input.generation.execution.awaitTerminal(requested.generationTaskId);
    const markdown = task.draftMarkdown?.trim() ?? '';
    if (task.status !== 'completed' || markdown === '') {
      return portraitModule.fail(
        requested.versionId,
        requested.generationTaskId,
        task.errorCode ?? 'ai_unavailable',
        `draft_${requested.generationTaskId}`,
      );
    }
    try {
      return await portraitModule.finalize(
        requested.versionId,
        requested.generationTaskId,
        parseStructuredJson(markdown),
      );
    } catch (error) {
      await portraitModule.fail(
        requested.versionId,
        requested.generationTaskId,
        error instanceof Error ? error.message : 'portrait_output_invalid',
        `draft_${requested.generationTaskId}`,
      );
      throw error;
    }
  }

  const portraitRefreshCoordinator = createPortraitRefreshCoordinator({
    perform: performPortraitRefresh,
  });
  const requestPortraitRefresh: PortraitRouteOptions['requestRefresh'] = (request) =>
    portraitRefreshCoordinator.request(request);
  const weeklyPortraitScheduler = createWeeklyPortraitScheduler({
    timeZone: 'Asia/Shanghai',
    now: input.now,
    refresh: ({ idempotencyKey, tokenBudget }) =>
      requestPortraitRefresh({ idempotencyKey, tokenBudget }),
  });

  const getTeachingPersonalization: TeachingContextSources['getPersonalizationView'] = async ({
    courseId,
    lessonId,
  }) => {
    const createdAt = input.now().toISOString();
    const digest = (await personalizationDigestRepository.get())?.latestSuccessful;
    const signals =
      digest === undefined || digest.summary.trim() === ''
        ? []
        : [
            {
              evidenceId: `personalization_digest_${digest.sourceSnapshotHash.slice(0, 24)}`,
              summary: digest.summary,
              explicitness: 'ai_observed' as const,
              sourceRefs: [...digest.sourceRefs],
              limitations: [
                '仅包含跨独立学习会话稳定出现的抽象维度与长期明确偏好，不包含当前单次会话候选判断。',
              ],
            },
          ];
    return {
      profileVersion: digest?.profileVersion ?? 0,
      purpose: 'interactive_teaching',
      courseId,
      lessonId,
      signals,
      completeness: signals.length === 0 ? 'insufficient' : 'limited',
      sourceSnapshotHash: digest?.sourceSnapshotHash ?? '0'.repeat(64),
      createdAt,
    };
  };

  const profileRoutes: ProfileRouteOptions = {
    getGlobalProfile: globalProfile,
    async listEvidence() {
      const episodes = [];
      for await (const episode of reasoningBehaviorRepository.listEpisodes())
        episodes.push(episode);
      const evidence = [];
      for await (const candidate of evidenceRepositories.evidence.list()) {
        evidence.push({
          ...candidate,
          summary: reasoningEvidenceSummaryForRead(candidate, episodes),
        });
      }
      return evidence;
    },
    async listReasoningEpisodes() {
      const episodes = [];
      for await (const episode of reasoningBehaviorRepository.listEpisodes())
        episodes.push(episode);
      return episodes;
    },
    refreshReasoningAnalysis: refreshAndProjectReasoningAnalysis,
    getReasoningAnalysis: (snapshotId) => reasoningBehaviorModule.getAnalysis(snapshotId),
  };

  async function portraitWithReasoning(versionId: string) {
    return portraitRepository.getVersion(versionId);
  }

  const portraitRoutes: PortraitRouteOptions = {
    requestRefresh: requestPortraitRefresh,
    async getCurrent() {
      const cursor = await portraitRepository.getCurrent();
      return cursor === undefined ? undefined : portraitWithReasoning(cursor.currentVersionId);
    },
    getVersion: portraitWithReasoning,
    nextCorrelationId: () => `correlation_${randomUUID()}`,
  };

  return {
    checkpointSink: { capture: enqueueProfileEvidenceCheckpoint },
    reasoningBehaviorSink: reasoningBehaviorModule,
    profileRoutes,
    portraitRoutes,
    requestPortraitRefresh,
    getTeachingPersonalization,
    refreshPersonalizationDigest,
    recoverReasoningAnalysis,
    getProjectionStatus: () => projectionStatus,
    start() {
      weeklyPortraitScheduler.start();
      void bootstrapSemanticProfileCore()
        .then(refreshPersonalizationDigest)
        .catch((error) => {
          void input
            .logProjectionEvent?.({
              level: 'error',
              component: 'SemanticProfileCoreBootstrap',
              correlationId: 'semantic_profile_core_bootstrap',
              eventCode: 'semantic_profile_core_bootstrap_failed',
              fields: { error },
            })
            .catch(() => undefined);
        });
    },
    async close() {
      weeklyPortraitScheduler.stop();
      await Promise.allSettled([
        profileEvidenceBarrier,
        personalizationDigestBarrier,
        ...(semanticCoreBootstrapBarrier === undefined ? [] : [semanticCoreBootstrapBarrier]),
        evidenceBarrier,
      ]);
    },
  };
}
