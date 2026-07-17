import { createHash } from 'node:crypto';

import {
  ReasoningBehaviorAnalysisSnapshotSchema,
  ReasoningBehaviorClassificationSchema,
  ReasoningBehaviorEpisodeSchema,
  ReasoningDimensionDefinitionSchema,
  type ReasoningAnalysisFilter,
  type ReasoningBehaviorEpisode,
} from '@learning-more/contracts';

import type { UnitOfWork } from '../../../persistence/unit-of-work.js';
import type { ReasoningBehaviorModule } from '../interface.js';
import type { ReasoningBehaviorAnalyzer } from '../ports/reasoning-behavior-analyzer.js';
import type {
  ReasoningBehaviorAnalysisRecord,
  ReasoningBehaviorRepository,
} from '../ports/reasoning-behavior-repository.js';
import { reconcileReasoningDimensions } from './reasoning-dimension-reconciler.js';

const EXTRACTOR_VERSION = 'reasoning-episode-extractor@1';
const REVIEW_SESSION_DIMENSION_EXTRACTOR_VERSION = 'review-session-dimension@1';

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalized(values: readonly string[] | undefined): string[] {
  return [...new Set(values ?? [])].sort(compareText);
}

function semanticKey(value: string): string {
  return value.trim().normalize('NFKC').toLocaleLowerCase('en-US');
}

function sessionSourceGroupId(sessionId: string): string {
  return `session:${sessionId}`;
}

function normalizeFilter(filter: Partial<ReasoningAnalysisFilter> = {}): ReasoningAnalysisFilter {
  return {
    ...(filter.windowStart === undefined ? {} : { windowStart: filter.windowStart }),
    ...(filter.windowEnd === undefined ? {} : { windowEnd: filter.windowEnd }),
    courseIds: normalized(filter.courseIds),
    lessonIds: normalized(filter.lessonIds),
    courseModes: normalized(filter.courseModes) as ReasoningAnalysisFilter['courseModes'],
    elicitations: normalized(filter.elicitations) as ReasoningAnalysisFilter['elicitations'],
  };
}

function included(episode: ReasoningBehaviorEpisode, filter: ReasoningAnalysisFilter): boolean {
  return (
    episode.status === 'active' &&
    episode.extractorVersion === REVIEW_SESSION_DIMENSION_EXTRACTOR_VERSION &&
    (filter.windowStart === undefined || episode.observedAt >= filter.windowStart) &&
    (filter.windowEnd === undefined || episode.observedAt <= filter.windowEnd) &&
    (filter.courseIds.length === 0 || filter.courseIds.includes(episode.courseId)) &&
    (filter.lessonIds.length === 0 || filter.lessonIds.includes(episode.lessonId)) &&
    (filter.courseModes.length === 0 || filter.courseModes.includes(episode.courseMode)) &&
    (filter.elicitations.length === 0 || filter.elicitations.includes(episode.elicitation))
  );
}

function filtersEqual(left: ReasoningAnalysisFilter, right: ReasoningAnalysisFilter): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isLaterAnalysis(
  candidate: ReasoningBehaviorAnalysisRecord,
  current: ReasoningBehaviorAnalysisRecord | undefined,
): boolean {
  if (current === undefined) return true;
  return (
    candidate.snapshot.createdAt > current.snapshot.createdAt ||
    (candidate.snapshot.createdAt === current.snapshot.createdAt &&
      candidate.snapshot.snapshotId > current.snapshot.snapshotId)
  );
}

export function createReasoningBehaviorModule(options: {
  repository: ReasoningBehaviorRepository;
  unitOfWork: UnitOfWork;
  analyzer: ReasoningBehaviorAnalyzer;
  now(): Date;
  nextTransactionId(): string;
}): ReasoningBehaviorModule {
  return {
    async captureFromObservation(input) {
      if (input.observation.status !== 'active') return { createdEpisodeIds: [] };
      const createdEpisodeIds: string[] = [];
      for (const entry of input.observation.entries) {
        if (entry.kind !== 'learner_reasoning_behavior') continue;
        const digest = sha256(
          JSON.stringify({
            sessionId: input.observation.sessionId,
            entryId: entry.entryId,
            sourceRefs: normalized(entry.sourceRefs),
            extractorVersion: EXTRACTOR_VERSION,
          }),
        );
        const episode = ReasoningBehaviorEpisodeSchema.parse({
          episodeId: `reasoning_episode_${digest.slice(0, 40)}`,
          schemaVersion: 1,
          courseId: input.courseId,
          lessonId: input.observation.lessonId,
          sessionId: input.observation.sessionId,
          courseMode: input.courseMode,
          behaviorSummary: entry.summary,
          sourceObservationRef: `observation:${input.observation.observationId}`,
          sourceRefs: normalized(entry.sourceRefs),
          sourceGroupId: sessionSourceGroupId(input.observation.sessionId),
          elicitation: entry.elicitation ?? 'unknown',
          observedAt: input.observation.observedAt,
          sourceSnapshotHash: input.observation.sourceSnapshotHash,
          extractorVersion: EXTRACTOR_VERSION,
          extractedAt: options.now().toISOString(),
          status: 'active',
          resourceVersion: 0,
        });
        const existing = await options.repository.getEpisode(episode.episodeId);
        if (existing !== undefined) {
          continue;
        }
        await options.unitOfWork.execute({ transactionId: options.nextTransactionId() }, (tx) =>
          options.repository.saveEpisode(tx, episode, 0),
        );
        createdEpisodeIds.push(episode.episodeId);
      }
      return { createdEpisodeIds };
    },

    async captureFromConfirmedAuthoring(input) {
      const sourceByRef = new Map(input.sources.map((source) => [source.sourceRef, source]));
      const createdEpisodeIds: string[] = [];
      for (const candidate of input.candidates) {
        if (
          candidate.candidateKind !== 'thinking_behavior' ||
          candidate.safetyStatus !== 'usable'
        ) {
          continue;
        }
        const sourceRefs = normalized(candidate.sourceRefs).filter((ref) => sourceByRef.has(ref));
        if (sourceRefs.length === 0) continue;
        const roles = sourceRefs.map((ref) => sourceByRef.get(ref)!.role);
        const elicitation = roles.every((role) => role === 'user')
          ? 'spontaneous'
          : roles.every((role) => role === 'assistant')
            ? 'elicited'
            : 'mixed';
        const digest = sha256(
          JSON.stringify({
            checkpointId: input.checkpointId,
            summary: candidate.summary,
            sourceRefs,
            extractorVersion: EXTRACTOR_VERSION,
          }),
        );
        const episode = ReasoningBehaviorEpisodeSchema.parse({
          episodeId: `reasoning_episode_${digest.slice(0, 40)}`,
          schemaVersion: 1,
          courseId: input.courseId,
          lessonId: 'authoring',
          sessionId: input.checkpointId,
          courseMode: input.courseMode,
          behaviorSummary: candidate.summary,
          sourceObservationRef: `profile-checkpoint:${input.checkpointId}`,
          sourceRefs,
          sourceGroupId: sessionSourceGroupId(input.checkpointId),
          elicitation,
          observedAt: sourceRefs
            .map((ref) => sourceByRef.get(ref)!.observedAt)
            .sort(compareText)
            .at(-1)!,
          sourceSnapshotHash: input.sourceSnapshotHash,
          extractorVersion: EXTRACTOR_VERSION,
          extractedAt: input.extractedAt,
          status: 'active',
          resourceVersion: 0,
        });
        const existing = await options.repository.getEpisode(episode.episodeId);
        if (existing !== undefined) continue;
        await options.unitOfWork.execute({ transactionId: options.nextTransactionId() }, (tx) =>
          options.repository.saveEpisode(tx, episode, 0),
        );
        createdEpisodeIds.push(episode.episodeId);
      }
      return { createdEpisodeIds };
    },

    async captureFromReview(input) {
      const drafts = input.candidates
        .filter(
          (candidate) =>
            candidate.candidateKind === 'thinking_behavior' && candidate.safetyStatus !== 'blocked',
        )
        .map((candidate) => {
          const sourceRefs = normalized(candidate.sourceRefs);
          const digest = sha256(
            JSON.stringify({
              sessionId: input.sessionId,
              checkpointId: input.checkpointId,
              claimDimension: candidate.claimDimension,
              label: semanticKey(candidate.label),
              sourceRefs,
              extractorVersion: REVIEW_SESSION_DIMENSION_EXTRACTOR_VERSION,
            }),
          );
          return ReasoningBehaviorEpisodeSchema.parse({
            episodeId: `reasoning_session_dimension_${digest.slice(0, 40)}`,
            schemaVersion: 1,
            courseId: input.courseId,
            lessonId: input.lessonId,
            sessionId: input.sessionId,
            courseMode: input.courseMode,
            behaviorSummary: `${candidate.label}：${candidate.summary}`,
            sourceObservationRef: `review-checkpoint:${input.checkpointId}`,
            sourceRefs,
            sourceGroupId: sessionSourceGroupId(input.sessionId),
            elicitation: 'unknown',
            observedAt: input.observedAt,
            sourceSnapshotHash: input.sourceSnapshotHash,
            extractorVersion: REVIEW_SESSION_DIMENSION_EXTRACTOR_VERSION,
            extractedAt: input.extractedAt,
            status: 'active',
            resourceVersion: 0,
          });
        });
      const nextIds = new Set(drafts.map((draft) => draft.episodeId));
      const superseded: ReasoningBehaviorEpisode[] = [];
      for await (const episode of options.repository.listEpisodes()) {
        if (
          episode.status === 'active' &&
          episode.sessionId === input.sessionId &&
          episode.extractorVersion === REVIEW_SESSION_DIMENSION_EXTRACTOR_VERSION &&
          !nextIds.has(episode.episodeId)
        ) {
          superseded.push({ ...episode, status: 'superseded' });
        }
      }
      const additions: ReasoningBehaviorEpisode[] = [];
      for (const draft of drafts) {
        if ((await options.repository.getEpisode(draft.episodeId)) === undefined) {
          additions.push(draft);
        }
      }
      if (superseded.length > 0 || additions.length > 0) {
        await options.unitOfWork.execute(
          { transactionId: options.nextTransactionId() },
          async (tx) => {
            for (const episode of superseded) {
              await options.repository.saveEpisode(tx, episode, episode.resourceVersion);
            }
            for (const episode of additions) {
              await options.repository.saveEpisode(tx, episode, 0);
            }
          },
        );
      }
      return { createdEpisodeIds: additions.map((episode) => episode.episodeId) };
    },

    async refreshAnalysis(filterInput = {}) {
      const filter = normalizeFilter(filterInput);
      const episodes: ReasoningBehaviorEpisode[] = [];
      for await (const episode of options.repository.listEpisodes()) {
        if (included(episode, filter)) episodes.push(episode);
      }
      episodes.sort((left, right) =>
        left.observedAt === right.observedAt
          ? compareText(left.episodeId, right.episodeId)
          : compareText(left.observedAt, right.observedAt),
      );
      if (episodes.length === 0) return undefined;
      let priorAnalysis: ReasoningBehaviorAnalysisRecord | undefined;
      for await (const record of options.repository.listAnalyses()) {
        if (
          record.snapshot.analyzerVersion === options.analyzer.version &&
          filtersEqual(record.snapshot.filter, filter) &&
          isLaterAnalysis(record, priorAnalysis)
        ) {
          priorAnalysis = record;
        }
      }
      const analyzed = await options.analyzer.analyze({
        episodes,
        priorDimensions: priorAnalysis?.dimensions ?? [],
      });
      const episodeIds = new Set(episodes.map((episode) => episode.episodeId));
      const seenLabels = new Set<string>();
      const drafts = analyzed.dimensions
        .filter((draft) => {
          const key = semanticKey(draft.label);
          if (key.length === 0 || seenLabels.has(key)) return false;
          seenLabels.add(key);
          return true;
        })
        .sort((left, right) => compareText(semanticKey(left.label), semanticKey(right.label)));
      for (const draft of drafts) {
        if (
          draft.derivedFromEpisodeIds.length === 0 ||
          draft.derivedFromEpisodeIds.some((episodeId) => !episodeIds.has(episodeId))
        ) {
          throw new Error('reasoning_dimension_source_invalid');
        }
      }
      const dimensionSetHash = sha256(
        JSON.stringify(
          drafts.map((draft) => ({
            ...draft,
            derivedFromEpisodeIds: normalized(draft.derivedFromEpisodeIds),
          })),
        ),
      );
      const dimensionSetVersion = `dimension-set:${dimensionSetHash.slice(0, 40)}`;
      const createdAt = options.now().toISOString();
      const reconciledDimensions = reconcileReasoningDimensions({
        drafts,
        activeDimensions: priorAnalysis?.dimensions ?? [],
      });
      const dimensions = reconciledDimensions.map(({ draft, ...lineage }) =>
        ReasoningDimensionDefinitionSchema.parse({
          dimensionId: lineage.dimensionId,
          dimensionSetVersion,
          label: draft.label,
          description: draft.description,
          inclusionSignals: normalized(draft.inclusionSignals),
          exclusionSignals: normalized(draft.exclusionSignals),
          derivedFromEpisodeIds: normalized(draft.derivedFromEpisodeIds),
          semanticFingerprint: lineage.semanticFingerprint,
          ...(lineage.continuesDimensionId === undefined
            ? {}
            : { continuesDimensionId: lineage.continuesDimensionId }),
          ...(lineage.supersedesDimensionIds.length === 0
            ? {}
            : { supersedesDimensionIds: lineage.supersedesDimensionIds }),
          analyzerVersion: options.analyzer.version,
          createdAt,
          status: 'active',
        }),
      );
      const dimensionByLabel = new Map(
        dimensions.map((dimension) => [semanticKey(dimension.label), dimension]),
      );
      const draftClassifications = new Map(
        analyzed.classifications.map((classification) => [
          classification.episodeId,
          classification,
        ]),
      );
      for (const episodeId of draftClassifications.keys()) {
        if (!episodeIds.has(episodeId)) throw new Error('reasoning_classification_source_invalid');
      }
      const classifications = episodes.map((episode) => {
        const draft = draftClassifications.get(episode.episodeId);
        const labelsByDimension = new Map<
          string,
          {
            dimensionId: string;
            rationale: string;
            confidence: number;
          }
        >();
        for (const label of draft?.labels ?? []) {
          const dimension = dimensionByLabel.get(semanticKey(label.label));
          if (dimension === undefined)
            throw new Error('reasoning_classification_dimension_invalid');
          const candidate = {
            dimensionId: dimension.dimensionId,
            rationale: label.rationale,
            confidence: label.confidence,
          };
          const current = labelsByDimension.get(dimension.dimensionId);
          if (current === undefined || candidate.confidence > current.confidence) {
            labelsByDimension.set(dimension.dimensionId, candidate);
          }
        }
        const labels = [...labelsByDimension.values()].sort((left, right) =>
          compareText(left.dimensionId, right.dimensionId),
        );
        return ReasoningBehaviorClassificationSchema.parse({
          classificationId: `reasoning_classification_${sha256(
            `${episode.episodeId}:${dimensionSetVersion}`,
          ).slice(0, 40)}`,
          episodeId: episode.episodeId,
          dimensionSetVersion,
          labels,
          analyzerVersion: options.analyzer.version,
          sourceSnapshotHash: episode.sourceSnapshotHash,
          classifiedAt: createdAt,
          status: 'active',
        });
      });
      const episodeById = new Map(episodes.map((episode) => [episode.episodeId, episode]));
      const counts = dimensions.map((dimension) => {
        const matched = classifications
          .filter((classification) =>
            classification.labels.some((label) => label.dimensionId === dimension.dimensionId),
          )
          .map((classification) => episodeById.get(classification.episodeId)!)
          .filter(Boolean);
        const elicitationCount = (value: ReasoningBehaviorEpisode['elicitation']) =>
          matched.filter((episode) => episode.elicitation === value).length;
        return {
          dimensionId: dimension.dimensionId,
          episodeCount: matched.length,
          episodeShare: matched.length / episodes.length,
          independentSourceGroupCount: new Set(
            matched.map((episode) => sessionSourceGroupId(episode.sessionId)),
          ).size,
          spontaneousCount: elicitationCount('spontaneous'),
          elicitedCount: elicitationCount('elicited'),
          mixedCount: elicitationCount('mixed'),
          unknownCount: elicitationCount('unknown'),
          courseCount: new Set(matched.map((episode) => episode.courseId)).size,
          lessonCount: new Set(matched.map((episode) => episode.lessonId)).size,
        };
      });
      const independentSourceGroupCount = new Set(
        episodes.map((episode) => sessionSourceGroupId(episode.sessionId)),
      ).size;
      const limitations = counts
        .filter((count) => count.independentSourceGroupCount < 2)
        .map(
          (count) =>
            `Dimension ${count.dimensionId} has fewer than two independent source groups and remains provisional.`,
        );
      const sourceSnapshotHash = sha256(
        JSON.stringify({
          filter,
          episodes: episodes.map((episode) => ({
            episodeId: episode.episodeId,
            sourceSnapshotHash: episode.sourceSnapshotHash,
            status: episode.status,
          })),
          dimensionSetVersion,
        }),
      );
      const snapshot = ReasoningBehaviorAnalysisSnapshotSchema.parse({
        snapshotId: `reasoning_snapshot_${sourceSnapshotHash.slice(0, 40)}`,
        schemaVersion: 1,
        dimensionSetVersion,
        analyzerVersion: options.analyzer.version,
        sourceEpisodeIds: episodes.map((episode) => episode.episodeId),
        filter,
        eligibleEpisodeCount: episodes.length,
        independentSourceGroupCount,
        dimensions: counts,
        limitations,
        sourceSnapshotHash,
        createdAt,
        status:
          dimensions.length > 0 && independentSourceGroupCount >= 2 ? 'usable' : 'provisional',
      });
      const existing = await options.repository.getAnalysis(snapshot.snapshotId);
      if (existing !== undefined) return existing;
      const record: ReasoningBehaviorAnalysisRecord = {
        snapshot,
        dimensions,
        classifications,
        resourceVersion: 0,
      };
      await options.unitOfWork.execute({ transactionId: options.nextTransactionId() }, (tx) =>
        options.repository.saveAnalysis(tx, record, 0),
      );
      return (await options.repository.getAnalysis(snapshot.snapshotId)) ?? record;
    },

    getAnalysis: (snapshotId) => options.repository.getAnalysis(snapshotId),
  };
}
