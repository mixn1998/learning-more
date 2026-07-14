import type {
  ReasoningBehaviorEpisode,
  ReasoningDimensionDefinition,
} from '@learning-more/contracts';

export type ReasoningDimensionDraft = Readonly<{
  label: string;
  description: string;
  inclusionSignals: readonly string[];
  exclusionSignals: readonly string[];
  derivedFromEpisodeIds: readonly string[];
}>;

export type ReasoningClassificationDraft = Readonly<{
  episodeId: string;
  labels: readonly Readonly<{
    label: string;
    rationale: string;
    confidence: number;
  }>[];
}>;

export interface ReasoningBehaviorAnalyzer {
  readonly version: string;
  analyze(input: {
    episodes: readonly ReasoningBehaviorEpisode[];
    priorDimensions: readonly ReasoningDimensionDefinition[];
  }): Promise<{
    dimensions: readonly ReasoningDimensionDraft[];
    classifications: readonly ReasoningClassificationDraft[];
  }>;
}
