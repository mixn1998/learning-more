import type {
  ReasoningBehaviorAnalysisSnapshot,
  ReasoningBehaviorClassification,
  ReasoningBehaviorEpisode,
  ReasoningDimensionDefinition,
} from '@learning-more/contracts';

import type { TransactionContext } from '../../../persistence/unit-of-work.js';

export type ReasoningBehaviorAnalysisRecord = Readonly<{
  snapshot: ReasoningBehaviorAnalysisSnapshot;
  dimensions: readonly ReasoningDimensionDefinition[];
  classifications: readonly ReasoningBehaviorClassification[];
  resourceVersion: number;
}>;

export interface ReasoningBehaviorRepository {
  getEpisode(episodeId: string): Promise<ReasoningBehaviorEpisode | undefined>;
  saveEpisode(
    tx: TransactionContext,
    episode: ReasoningBehaviorEpisode,
    expectedVersion: number,
  ): Promise<void>;
  listEpisodes(): AsyncIterable<ReasoningBehaviorEpisode>;
  getAnalysis(snapshotId: string): Promise<ReasoningBehaviorAnalysisRecord | undefined>;
  saveAnalysis(
    tx: TransactionContext,
    record: ReasoningBehaviorAnalysisRecord,
    expectedVersion: number,
  ): Promise<void>;
  listAnalyses(): AsyncIterable<ReasoningBehaviorAnalysisRecord>;
}
