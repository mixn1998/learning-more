import type { TransactionContext } from '../../../persistence/unit-of-work.js';
import type { OutlineSession } from '../model/outline-session.js';

export interface OutlineSessionRecord {
  readonly session: OutlineSession;
  readonly resourceVersion: number;
  readonly candidateCommandReceipts: Readonly<Record<string, { taskId: string }>>;
}

export interface OutlineSessionRepository {
  get(outlineSessionId: string): Promise<OutlineSessionRecord | undefined>;
  save(
    tx: TransactionContext,
    record: OutlineSessionRecord,
    expectedVersion: number,
  ): Promise<void>;
  list(): AsyncIterable<OutlineSessionRecord>;
}
