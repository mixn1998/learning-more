import type { TeachingObservation, TeachingStateSnapshot } from '@learning-more/contracts';

import type { MaterializedTeachingMessage } from './teaching-context-sources.js';

export type TeachingObservationLens = Readonly<{
  priority: string;
  nonRequirements: readonly string[];
}>;

export type TeachingObservationInput = Readonly<{
  lessonId: string;
  sessionId: string;
  turnSequence: number;
  sourceSnapshotHash: string;
  knowledgePointRefs: readonly string[];
  courseRelationRefs: readonly string[];
  observationLens: TeachingObservationLens;
  previousState: TeachingStateSnapshot;
  messages: readonly MaterializedTeachingMessage[];
}>;

export interface TeachingObserver {
  observe(input: TeachingObservationInput): Promise<TeachingObservation>;
}
