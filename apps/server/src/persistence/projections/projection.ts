import type { LearningEventEnvelope } from '@learning-more/contracts';

export interface Projection<TState> {
  readonly name: string;
  readonly schemaVersion: number;
  initial(): TState;
  apply(state: TState, event: LearningEventEnvelope): TState;
}

export interface ProjectionCheckpoint {
  readonly projection: string;
  readonly schemaVersion: number;
  readonly lastEventId?: string;
  readonly lastEventOffset: number;
  readonly stateChecksum: string;
}

export interface ProjectionRunResult<TState> {
  readonly state: TState;
  readonly stateJson: string;
  readonly stateChecksum: string;
  readonly checkpoint: ProjectionCheckpoint;
}
