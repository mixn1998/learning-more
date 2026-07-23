import type {
  TeachingCheckpointSnapshot,
  TeachingObservation,
  TeachingStateSnapshot,
} from '@learning-more/contracts';

import type { TransactionContext } from '../../../persistence/unit-of-work.js';

export type TeachingLedgerRecord = Readonly<{
  courseId: string;
  lessonId: string;
  sessionId: string;
  observations: readonly TeachingObservation[];
  checkpoints: readonly TeachingCheckpointSnapshot[];
  state: TeachingStateSnapshot;
  resourceVersion: number;
}>;

export interface TeachingLedgerRepository {
  get(sessionId: string): Promise<TeachingLedgerRecord | undefined>;
  save(
    tx: TransactionContext,
    record: TeachingLedgerRecord,
    expectedVersion: number,
  ): Promise<void>;
  delete(tx: TransactionContext, sessionId: string, expectedVersion: number): Promise<void>;
  list(filter?: Readonly<{ courseId?: string }>): AsyncIterable<TeachingLedgerRecord>;
}
