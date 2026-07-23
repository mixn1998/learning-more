import type { TransactionContext } from '../../../persistence/unit-of-work.js';

export type PersonalizationDigestSnapshot = Readonly<{
  projectionVersion: 'semantic-profile-digest@1';
  profileVersion: number;
  sourceSnapshotHash: string;
  summary: string;
  selectedModeIds: readonly string[];
  sourceRefs: readonly string[];
  generatedAt: string;
}>;

export type PersonalizationDigestRecord = Readonly<{
  digestId: 'interactive_teaching';
  resourceVersion: number;
  requestedProfileVersion: number;
  requestedSourceSnapshotHash: string;
  refreshStatus: 'pending' | 'succeeded' | 'failed';
  latestSuccessful?: PersonalizationDigestSnapshot;
  lastError?: string;
  updatedAt: string;
}>;

export interface PersonalizationDigestRepository {
  get(): Promise<PersonalizationDigestRecord | undefined>;
  save(
    tx: TransactionContext,
    record: PersonalizationDigestRecord,
    expectedVersion: number,
  ): Promise<void>;
}
