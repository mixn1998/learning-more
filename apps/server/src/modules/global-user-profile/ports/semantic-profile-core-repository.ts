import type { TransactionContext } from '../../../persistence/unit-of-work.js';

export type SemanticProfileMode = Readonly<{
  modeId: string;
  origin: 'observed_behavior' | 'explicit_preference';
  status: 'candidate' | 'stable';
  feature: string;
  teachingImpact: string;
  applicabilityBoundary: string;
  supportingSessionCount: number;
  representativeEvidenceIds: readonly string[];
  representativeSourceRefs: readonly string[];
  priority: number;
  createdAt: string;
  updatedAt: string;
}>;

export type SemanticProfileCoreRecord = Readonly<{
  coreId: 'global_learning';
  schemaVersion: 1;
  mergerVersion: string;
  sourceSnapshotHash: string;
  modes: readonly SemanticProfileMode[];
  updatedAt: string;
  resourceVersion: number;
}>;

export type SemanticProfileSourceReceipt = Readonly<{
  receiptId: string;
  sourceId: string;
  sourceSnapshotHash: string;
  sourceGroupId: string;
  appliedModeIds: readonly string[];
  createdAt: string;
}>;

export interface SemanticProfileCoreRepository {
  getCore(): Promise<SemanticProfileCoreRecord | undefined>;
  saveCore(
    tx: TransactionContext,
    core: SemanticProfileCoreRecord,
    expectedVersion: number,
  ): Promise<void>;
  getReceipt(receiptId: string): Promise<SemanticProfileSourceReceipt | undefined>;
  saveReceipt(tx: TransactionContext, receipt: SemanticProfileSourceReceipt): Promise<void>;
}
