import { createHash, randomUUID } from 'node:crypto';

import type { PortraitRouteOptions } from '../../http/routes/portraits.js';
import type { ProfileRouteOptions } from '../../http/routes/profile.js';
import { createGenerationReasoningBehaviorAnalyzer } from '../../modules/global-user-profile/implementation/generation-reasoning-behavior-analyzer.js';
import { createReasoningBehaviorModule } from '../../modules/global-user-profile/implementation/reasoning-behavior-module.js';
import type { ReasoningBehaviorAnalysisRecord } from '../../modules/global-user-profile/ports/reasoning-behavior-repository.js';
import type { TeachingContextSources } from '../../modules/interactive-teaching/ports/teaching-context-sources.js';
import type { AdditionalWeeklyEvidence } from '../../modules/learning-facts/implementation/weekly-evidence-assembler.js';
import { packPortraitEvidence } from '../../modules/learning-portrait/implementation/evidence-packer.js';
import { createPortraitModule } from '../../modules/learning-portrait/implementation/portrait-module.js';
import { createPortraitRefreshCoordinator } from '../../modules/learning-portrait/implementation/portrait-refresh-coordinator.js';
import { createWeeklyPortraitScheduler } from '../../modules/learning-portrait/implementation/weekly-portrait-scheduler.js';
import { createAiProfileEvidenceExtractor } from '../../modules/profile-evidence/implementation/ai-profile-evidence-extractor.js';
import { createProfileEvidenceAggregator } from '../../modules/profile-evidence/implementation/profile-evidence-aggregator.js';
import { assembleProfileEvidenceContext } from '../../modules/profile-evidence/implementation/profile-evidence-context-assembler.js';
import { purgeDeprecatedReasoningEvidence } from '../../modules/profile-evidence/implementation/deprecated-reasoning-evidence-migration.js';
import { createProfileEvidencePipeline } from '../../modules/profile-evidence/implementation/pipeline.js';
import { reasoningEvidenceSummaryForRead } from '../../modules/profile-evidence/implementation/reasoning-evidence-summary.js';
import { queryGlobalLearningProfile } from '../../modules/profile-evidence/implementation/profile-query.js';
import { createReasoningEvidenceProjector } from '../../modules/profile-evidence/implementation/reasoning-evidence-projector.js';
import { isGovernedBehaviorDetail } from '../../modules/profile-evidence/interface.js';
import type { DataRoot } from '../../persistence/data-root.js';
import { createLocalFilePortraitRepository } from '../../persistence/portrait-repositories.js';
import { createLocalFileEvidenceRepositories } from '../../persistence/profile-evidence-repositories.js';
import { createLocalFileReasoningBehaviorRepository } from '../../persistence/reasoning-behavior-repositories.js';
import type { UnitOfWork } from '../../persistence/unit-of-work.js';
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
  listWeeklyReasoningEvidence(): Promise<readonly AdditionalWeeklyEvidence[]>;
  recoverReasoningAnalysis(): Promise<void>;
  getProjectionStatus(): 'ready' | 'degraded';
  start(): void;
  close(): void;
}>;

export function createLocalProfileRuntime(
  input: Readonly<{
    dataRoot: DataRoot;
    unitOfWork: UnitOfWork;
    now: () => Date;
    generation: LocalGenerationRuntime;
    events: LocalEventFactsRuntime;
  }>,
): LocalProfileRuntime {
  const evidenceRepositories = createLocalFileEvidenceRepositories(input.dataRoot);
  const reasoningBehaviorRepository = createLocalFileReasoningBehaviorRepository(input.dataRoot);
  const portraitRepository = createLocalFilePortraitRepository(input.dataRoot);
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
        const sessionSource = extracted.checkpoint.dependentSourceGroupIds
          .map((sourceGroupId) => /^lesson:([^:]+):session:(.+)$/u.exec(sourceGroupId))
          .find((match): match is RegExpExecArray => match !== null);
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
      await checkpointRecovery.markCompleted({
        checkpointId: extracted.checkpoint.checkpointId,
        sourceType: extracted.checkpoint.sourceType,
        sourceSnapshotHash: extracted.sourceSnapshotHash,
        projectedCandidateCount,
        ignoredCandidateCount: extracted.candidates.length - projectedCandidateCount,
        updatedAt: extracted.extractedAt,
      });
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

  function stableReasoningDimensions(analysis: ReasoningBehaviorAnalysisRecord | undefined) {
    if (analysis === undefined) return [];
    const stableIds = new Set(
      analysis.snapshot.dimensions
        .filter((dimension) => dimension.independentSourceGroupCount >= 2)
        .map((dimension) => dimension.dimensionId),
    );
    return analysis.dimensions.filter((dimension) => stableIds.has(dimension.dimensionId));
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
    } catch {
      projectionStatus = 'degraded';
    }
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
    await recoverReasoningAnalysis();
    const [profile, reasoningBehaviorAnalysis] = await Promise.all([
      globalProfile(),
      latestUsableReasoningAnalysis(),
    ]);
    const stableReasoning = stableReasoningDimensions(reasoningBehaviorAnalysis);
    const candidates = [];
    for await (const candidate of evidenceRepositories.evidence.list()) candidates.push(candidate);
    const packedEvidence = packPortraitEvidence({
      evidence: candidates,
      tokenBudget: inputRequest.tokenBudget,
      dimensionPriority: [],
    });
    const requested = await portraitModule.requestRefresh({
      profileVersion: profile.profileSchemaVersion,
      packedEvidence,
      window: profile.window,
      promptTemplateVersion: 'portrait@1',
      providerConfigFingerprint: createHash('sha256').update('mock').digest('hex'),
      ...(reasoningBehaviorAnalysis === undefined || stableReasoning.length === 0
        ? {}
        : {
            reasoningBehaviorInput: {
              snapshotId: reasoningBehaviorAnalysis.snapshot.snapshotId,
              sourceSnapshotHash: reasoningBehaviorAnalysis.snapshot.sourceSnapshotHash,
              dimensionSetVersion: reasoningBehaviorAnalysis.snapshot.dimensionSetVersion,
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
    const reasoning = await latestUsableReasoningAnalysis();
    const createdAt = input.now().toISOString();
    const reasoningSignals = stableReasoningDimensions(reasoning)
      .slice(0, 8)
      .map((dimension) => ({
        evidenceId: dimension.dimensionId,
        summary: `当前证据窗口中出现“${dimension.label}”：${dimension.description}`,
        explicitness: 'ai_observed' as const,
        sourceRefs: dimension.derivedFromEpisodeIds.map(
          (episodeId) => `reasoning-episode:${episodeId}`,
        ),
        limitations: [
          '这是从当前证据窗口动态归纳的学习行为维度，不是永久人格、能力等级或固定思维类型。',
        ],
      }));
    const candidateSignals = [];
    let candidateProfileVersion = 0;
    for await (const candidate of evidenceRepositories.evidence.list()) {
      const governance = candidate.governance;
      if (
        candidate.status !== 'active' ||
        governance === undefined ||
        isGovernedBehaviorDetail(candidate) ||
        governance.safetyStatus === 'blocked' ||
        governance.confidence < 0.65 ||
        (governance.explicitness === 'ai_observed' && governance.observedCount < 2)
      ) {
        continue;
      }
      const expiry = governance.expiryPolicy;
      const expiryAt =
        expiry.kind === 'until_corrected'
          ? undefined
          : expiry.kind === 'window_bound'
            ? expiry.expiresAt
            : expiry.reviewAt;
      if (expiryAt !== undefined && Date.parse(expiryAt) <= input.now().getTime()) continue;
      candidateProfileVersion = Math.max(candidateProfileVersion, candidate.resourceVersion);
      candidateSignals.push({
        evidenceId: candidate.evidenceId,
        summary: `${governance.label}：${candidate.summary}`,
        explicitness: governance.explicitness,
        sourceRefs: [...candidate.sourceRefs],
        limitations: [
          ...governance.limitations,
          '该信号是可撤回的候选证据，只用于调整当前教学表达与探查方式，不代表已确认的全局用户档案事实。',
        ],
      });
    }
    const signals = [...candidateSignals, ...reasoningSignals]
      .filter(
        (signal, index, all) =>
          all.findIndex((candidate) => candidate.evidenceId === signal.evidenceId) === index,
      )
      .slice(0, 8);
    return {
      profileVersion: Math.max(reasoning?.resourceVersion ?? 0, candidateProfileVersion),
      purpose: 'interactive_teaching',
      courseId,
      lessonId,
      signals,
      completeness: signals.length === 0 ? 'insufficient' : 'limited',
      sourceSnapshotHash: createHash('sha256')
        .update(
          JSON.stringify({
            courseId,
            lessonId,
            reasoningSource: reasoning?.snapshot.sourceSnapshotHash,
            evidenceIds: signals.map((signal) => signal.evidenceId),
          }),
        )
        .digest('hex'),
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
    const [portrait, reasoningBehaviorAnalysis] = await Promise.all([
      portraitRepository.getVersion(versionId),
      latestUsableReasoningAnalysis(),
    ]);
    const stableDimensions = stableReasoningDimensions(reasoningBehaviorAnalysis);
    const stableIds = new Set(stableDimensions.map((dimension) => dimension.dimensionId));
    return portrait === undefined
      ? undefined
      : {
          ...portrait,
          ...(reasoningBehaviorAnalysis === undefined || stableDimensions.length === 0
            ? {}
            : {
                reasoningBehaviorAnalysis: {
                  snapshot: {
                    ...reasoningBehaviorAnalysis.snapshot,
                    dimensions: reasoningBehaviorAnalysis.snapshot.dimensions.filter((dimension) =>
                      stableIds.has(dimension.dimensionId),
                    ),
                  },
                  dimensions: stableDimensions,
                },
              }),
        };
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
    async listWeeklyReasoningEvidence() {
      const evidence: AdditionalWeeklyEvidence[] = [];
      for await (const episode of reasoningBehaviorRepository.listEpisodes()) {
        if (
          episode.status !== 'active' ||
          episode.extractorVersion !== 'reasoning-episode-extractor@1'
        ) {
          continue;
        }
        evidence.push({
          factId: `reasoning:${episode.episodeId}`,
          sourceRef: `reasoning:${episode.episodeId}`,
          kind: 'reasoning-evidence',
          occurredAt: episode.observedAt,
          summary: episode.behaviorSummary,
          payload: {
            elicitation: episode.elicitation,
            sourceRefs: episode.sourceRefs,
            extractorVersion: episode.extractorVersion,
          },
          courseId: episode.courseId,
          lessonId: episode.lessonId,
          actualSeconds: 0,
          topicTags: [],
        });
      }
      return evidence;
    },
    recoverReasoningAnalysis,
    getProjectionStatus: () => projectionStatus,
    start: weeklyPortraitScheduler.start,
    close: weeklyPortraitScheduler.stop,
  };
}
