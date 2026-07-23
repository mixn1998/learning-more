import type { DataKey } from '@learning-more/contracts';

export type LearningFactType =
  | 'LessonStartedFact'
  | 'LessonPausedFact'
  | 'LessonAbandonedFact'
  | 'LessonRestoredFact'
  | 'LessonCompletedFact'
  | 'CourseCreatedFact'
  | 'CourseClosedFact'
  | 'ReviewFinalizedFact'
  | 'CourseReviewFinalizedFact'
  | 'ScheduleConfirmedFact'
  | 'InteractionPromptedFact'
  | 'InteractionRespondedFact'
  | 'InteractionSkippedFact';

export interface LearningFact<TPayload = Readonly<Record<string, unknown>>> {
  readonly factId: string;
  readonly factType: LearningFactType;
  readonly subjectRefs: Readonly<Record<string, string>>;
  readonly occurredAt: string;
  readonly recordedAt: string;
  readonly sourceEventId: string;
  readonly dataKeys: readonly DataKey[];
  readonly payload: TPayload;
  readonly schemaVersion: number;
}

export interface ReadModelStatus {
  readonly asOfEventId?: string;
  readonly projectionVersion: number;
  readonly freshness: 'current' | 'stale' | 'rebuilding';
}
