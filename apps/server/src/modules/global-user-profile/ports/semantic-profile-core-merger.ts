export type SemanticProfileObservation = Readonly<{
  observationId: string;
  origin: 'observed_behavior' | 'explicit_preference';
  summary: string;
  evidenceIds: readonly string[];
  supportingSessionCount?: number;
  sourceRefs: readonly string[];
}>;

export type SemanticProfileModeView = Readonly<{
  modeId: string;
  origin: 'observed_behavior' | 'explicit_preference';
  status: 'candidate' | 'stable';
  feature: string;
  teachingImpact: string;
  applicabilityBoundary: string;
  supportingSessionCount: number;
  priority: number;
}>;

export type SemanticProfileMergeAssignment = Readonly<{
  sourceModeIds: readonly string[];
  observationIds: readonly string[];
  mode: Readonly<{
    origin: 'observed_behavior' | 'explicit_preference';
    feature: string;
    teachingImpact: string;
    applicabilityBoundary: string;
    priority: number;
  }>;
}>;

export interface SemanticProfileCoreMerger {
  readonly version: string;
  merge(input: {
    currentModes: readonly SemanticProfileModeView[];
    observations: readonly SemanticProfileObservation[];
  }): Promise<{
    assignments: readonly SemanticProfileMergeAssignment[];
    ignoredObservationIds: readonly string[];
  }>;
}
