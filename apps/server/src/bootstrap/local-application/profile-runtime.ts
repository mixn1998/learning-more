import { createHash, randomUUID } from 'node:crypto';

import type { ProfileRouteOptions } from '../../http/routes/profile.js';
import { createGenerationReasoningBehaviorAnalyzer } from '../../modules/global-user-profile/implementation/generation-reasoning-behavior-analyzer.js';
import { createGenerationSemanticProfileCoreMerger } from '../../modules/global-user-profile/implementation/generation-semantic-profile-core-merger.js';
import { createReasoningBehaviorModule } from '../../modules/global-user-profile/implementation/reasoning-behavior-module.js';
import { createCrossSessionSemanticCore } from '../../modules/global-user-profile/implementation/semantic-profile-core.js';
import type { ReasoningBehaviorAnalysisRecord } from '../../modules/global-user-profile/ports/reasoning-behavior-repository.js';
import { createAiProfileEvidenceExtractor } from '../../modules/profile-evidence/implementation/ai-profile-evidence-extractor.js';
import type { CandidateEvidence } from '../../modules/profile-evidence/interface.js';
import { createProfileEvidenceAggregator } from '../../modules/profile-evidence/implementation/profile-evidence-aggregator.js';
import { assembleProfileEvidenceContext } from '../../modules/profile-evidence/implementation/profile-evidence-context-assembler.js';
import { createReasoningEvidenceProjector } from '../../modules/profile-evidence/implementation/reasoning-evidence-projector.js';
import type { DataRoot } from '../../persistence/data-root.js';
import { createLocalFileEvidenceRepositories } from '../../persistence/profile-evidence-repositories.js';
import { createLocalFileReasoningBehaviorRepository } from '../../persistence/reasoning-behavior-repositories.js';
import { createLocalFileSemanticProfileCoreRepository } from '../../persistence/semantic-profile-core-repositories.js';
import type { UnitOfWork } from '../../persistence/unit-of-work.js';
import type { StructuredLogInput } from '../../runtime/logger.js';
import {
  createProfileEvidenceCheckpointRecovery,
  PROFILE_EVIDENCE_EXTRACTOR_VERSION,
} from './profile-evidence-checkpoint-recovery.js';
import type { LocalGenerationRuntime } from './generation-runtime.js';

export type LocalProfileRuntime = Readonly<{
  checkpointSink: Readonly<{ capture(input: unknown): Promise<void> }>;
  reasoningBehaviorSink: ReturnType<typeof createReasoningBehaviorModule>;
  profileRoutes: ProfileRouteOptions;
  recoverReasoningAnalysis(): Promise<void>;
  start(): void;
  close(): Promise<void>;
}>;

export function createLocalProfileRuntime(
  input: Readonly<{
    dataRoot: DataRoot;
    unitOfWork: UnitOfWork;
    now: () => Date;
    generation: LocalGenerationRuntime;
    logProjectionEvent?: (input: StructuredLogInput) => Promise<void>;
  }>,
): LocalProfileRuntime {
  const evidenceRepositories = createLocalFileEvidenceRepositories(input.dataRoot);
  const reasoningBehaviorRepository = createLocalFileReasoningBehaviorRepository(input.dataRoot);
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
    });
    profileEvidenceBarrier = queued.catch(() => undefined);
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

  async function refreshAndProjectReasoningAnalysis(
    filter?: Parameters<typeof reasoningBehaviorModule.refreshAnalysis>[0],
  ) {
    const analysis = await reasoningBehaviorModule.refreshAnalysis(filter);
    if (analysis !== undefined) await reasoningEvidenceProjector.project(analysis);
    return analysis;
  }

  async function recoverReasoningAnalysis(): Promise<void> {
    try {
      await refreshAndProjectReasoningAnalysis();
    } catch (error) {
      await input
        .logProjectionEvent?.({
          level: 'error',
          component: 'UserProfileRecovery',
          correlationId: 'recover_reasoning_analysis',
          eventCode: 'user_profile_recovery_failed',
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

  const profileRoutes: ProfileRouteOptions = {
    async listReasoningEpisodes() {
      const episodes = [];
      for await (const episode of reasoningBehaviorRepository.listEpisodes())
        episodes.push(episode);
      return episodes;
    },
    refreshReasoningAnalysis: refreshAndProjectReasoningAnalysis,
    getReasoningAnalysis: (snapshotId) => reasoningBehaviorModule.getAnalysis(snapshotId),
  };

  return {
    checkpointSink: { capture: enqueueProfileEvidenceCheckpoint },
    reasoningBehaviorSink: reasoningBehaviorModule,
    profileRoutes,
    recoverReasoningAnalysis,
    start() {
      void bootstrapSemanticProfileCore().catch((error) => {
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
      await Promise.allSettled([
        profileEvidenceBarrier,
        ...(semanticCoreBootstrapBarrier === undefined ? [] : [semanticCoreBootstrapBarrier]),
      ]);
    },
  };
}
