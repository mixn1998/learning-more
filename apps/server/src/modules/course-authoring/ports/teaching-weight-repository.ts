import type { TransactionContext } from '../../../persistence/unit-of-work.js';

export type TeachingWeightMetadataRecord = Readonly<{
  schemaVersion: 1;
  outlineVersionId: string;
  courseId: string;
  analyzerVersion: string;
  sourceSnapshotHash: string;
  state: 'generating' | 'completed' | 'failed';
  attempt: number;
  generationTaskId?: string;
  keyKnowledgePoints: readonly Readonly<{
    lessonId: string;
    knowledgePointIndex: number;
    rationale: string;
  }>[];
  errorCode?: string;
  createdAt: string;
  updatedAt: string;
  resourceVersion: number;
}>;

export interface TeachingWeightRepository {
  get(outlineVersionId: string): Promise<TeachingWeightMetadataRecord | undefined>;
  save(
    tx: TransactionContext,
    record: TeachingWeightMetadataRecord,
    expectedVersion: number,
  ): Promise<void>;
}
