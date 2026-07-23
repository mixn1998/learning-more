import type {
  CourseMode,
  ReasoningAnalysisFilter,
  TeachingObservation,
} from '@learning-more/contracts';

import type { ReasoningBehaviorAnalysisRecord } from './ports/reasoning-behavior-repository.js';

export type { ReasoningBehaviorAnalysisRecord } from './ports/reasoning-behavior-repository.js';

export interface ReasoningBehaviorEpisodeSource {
  getEpisode(
    episodeId: string,
  ): Promise<import('@learning-more/contracts').ReasoningBehaviorEpisode | undefined>;
}

export interface ReasoningBehaviorModule {
  captureFromObservation(input: {
    courseId: string;
    courseMode: CourseMode;
    observation: TeachingObservation;
  }): Promise<{ createdEpisodeIds: readonly string[] }>;
  captureFromConfirmedAuthoring(input: {
    courseId: string;
    courseMode: CourseMode;
    checkpointId: string;
    sourceGroupId: string;
    sourceSnapshotHash: string;
    extractedAt: string;
    sources: readonly Readonly<{
      sourceRef: string;
      role: 'user' | 'assistant';
      observedAt: string;
    }>[];
    candidates: readonly Readonly<{
      candidateKind: string;
      summary: string;
      sourceRefs: readonly string[];
      safetyStatus: string;
    }>[];
  }): Promise<{ createdEpisodeIds: readonly string[] }>;
  captureFromReview(input: {
    courseId: string;
    courseMode: CourseMode;
    lessonId: string;
    sessionId: string;
    checkpointId: string;
    sourceSnapshotHash: string;
    extractedAt: string;
    observedAt: string;
    candidates: readonly Readonly<{
      candidateKind: string;
      claimDimension: string;
      label: string;
      summary: string;
      sourceRefs: readonly string[];
      confidence: number;
      safetyStatus: string;
    }>[];
  }): Promise<{ createdEpisodeIds: readonly string[] }>;
  refreshAnalysis(
    filter?: Partial<ReasoningAnalysisFilter>,
  ): Promise<ReasoningBehaviorAnalysisRecord | undefined>;
  getAnalysis(snapshotId: string): Promise<ReasoningBehaviorAnalysisRecord | undefined>;
}
