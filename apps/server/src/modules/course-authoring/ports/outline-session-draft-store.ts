import type { TransactionContext } from '../../../persistence/unit-of-work.js';

export type OutlineSessionDraftDeletionManifest = Readonly<{
  outlineSessionId: string;
  deletedCounts: Readonly<Record<string, number>>;
}>;

export interface OutlineSessionDraftStore {
  stageDelete(
    tx: TransactionContext,
    outlineSessionId: string,
  ): Promise<OutlineSessionDraftDeletionManifest>;
}
