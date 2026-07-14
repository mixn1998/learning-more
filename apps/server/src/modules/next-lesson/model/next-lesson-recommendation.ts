export type NextLessonRecommendationStatus = 'current' | 'stale' | 'fallback';

export type NextLessonRecommendationVersion = Readonly<{
  versionId: string;
  semanticKey: string;
  rankedSemanticKeys: readonly string[];
  rationale: string;
  evidenceRefs: readonly string[];
  confidence: number;
  expiresAt: string;
  sourceSnapshotHash: string;
  status: NextLessonRecommendationStatus;
  warnings: readonly string[];
}>;

export type StoredNextLessonRecommendation = Readonly<{
  versionId: string;
  recommendedLessonId: string;
  rankedLessonIds: readonly string[];
  rationale: string;
  evidenceRefs: readonly string[];
  confidence: number;
  expiresAt: string;
  sourceSnapshotHash: string;
  status: NextLessonRecommendationStatus;
  warnings: readonly string[];
}>;
