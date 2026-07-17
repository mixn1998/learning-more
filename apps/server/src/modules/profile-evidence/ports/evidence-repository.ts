import { RepositoryVersionConflictError } from '../../../persistence/repository-errors.js';
import type { TransactionContext } from '../../../persistence/unit-of-work.js';
import type { CandidateEvidence, RejectedEvidenceRecord, SourceCheckpoint } from '../interface.js';

export class EvidenceDuplicateError extends Error {
  readonly code = 'evidence_duplicate';

  constructor(readonly existingEvidenceId: string) {
    super('evidence_duplicate');
    this.name = 'EvidenceDuplicateError';
  }
}

export interface CandidateEvidenceRepository {
  get(evidenceId: string): Promise<CandidateEvidence | undefined>;
  findByDedupKey(dedupKey: string): Promise<CandidateEvidence | undefined>;
  save(tx: TransactionContext, evidence: CandidateEvidence, expectedVersion: number): Promise<void>;
  delete(tx: TransactionContext, evidenceId: string, expectedVersion: number): Promise<void>;
  list(): AsyncIterable<CandidateEvidence>;
}

export interface SourceCheckpointRepository {
  get(checkpointId: string): Promise<SourceCheckpoint | undefined>;
  save(
    tx: TransactionContext,
    checkpoint: SourceCheckpoint,
    expectedVersion: number,
  ): Promise<void>;
  list(): AsyncIterable<SourceCheckpoint>;
}

export interface RejectedEvidenceRepository {
  get(rejectionId: string): Promise<RejectedEvidenceRecord | undefined>;
  save(tx: TransactionContext, record: RejectedEvidenceRecord): Promise<void>;
  list(): AsyncIterable<RejectedEvidenceRecord>;
}

export type EvidenceRepositories = Readonly<{
  evidence: CandidateEvidenceRepository;
  checkpoints: SourceCheckpointRepository;
  rejections: RejectedEvidenceRepository;
}>;

export function createInMemoryEvidenceRepositories(): EvidenceRepositories {
  const evidenceRecords = new Map<string, CandidateEvidence>();
  const checkpoints = new Map<string, SourceCheckpoint>();
  const rejections = new Map<string, RejectedEvidenceRecord>();
  const evidence: CandidateEvidenceRepository = {
    get: async (id) => structuredClone(evidenceRecords.get(id)),
    async findByDedupKey(dedupKey) {
      return structuredClone(
        [...evidenceRecords.values()].find((item) => item.dedupKey === dedupKey),
      );
    },
    async save(_tx, candidate, expectedVersion) {
      const current = evidenceRecords.get(candidate.evidenceId);
      const currentVersion = current?.resourceVersion ?? 0;
      if (currentVersion !== expectedVersion || candidate.resourceVersion !== expectedVersion) {
        throw new RepositoryVersionConflictError(currentVersion);
      }
      const duplicate = [...evidenceRecords.values()].find(
        (item) => item.dedupKey === candidate.dedupKey && item.evidenceId !== candidate.evidenceId,
      );
      if (duplicate !== undefined) throw new EvidenceDuplicateError(duplicate.evidenceId);
      evidenceRecords.set(
        candidate.evidenceId,
        structuredClone({ ...candidate, resourceVersion: expectedVersion + 1 }),
      );
    },
    async delete(_tx, evidenceId, expectedVersion) {
      const current = evidenceRecords.get(evidenceId);
      if (current === undefined) return;
      if (current.resourceVersion !== expectedVersion) {
        throw new RepositoryVersionConflictError(current.resourceVersion);
      }
      evidenceRecords.delete(evidenceId);
    },
    async *list() {
      for (const id of [...evidenceRecords.keys()].sort()) {
        yield structuredClone(evidenceRecords.get(id)!);
      }
    },
  };
  const checkpointRepository: SourceCheckpointRepository = {
    get: async (id) => structuredClone(checkpoints.get(id)),
    async save(_tx, checkpoint, expectedVersion) {
      const currentVersion = checkpoints.get(checkpoint.checkpointId)?.resourceVersion ?? 0;
      if (currentVersion !== expectedVersion || checkpoint.resourceVersion !== expectedVersion) {
        throw new RepositoryVersionConflictError(currentVersion);
      }
      checkpoints.set(
        checkpoint.checkpointId,
        structuredClone({ ...checkpoint, resourceVersion: expectedVersion + 1 }),
      );
    },
    async *list() {
      for (const id of [...checkpoints.keys()].sort()) {
        yield structuredClone(checkpoints.get(id)!);
      }
    },
  };
  const rejectionRepository: RejectedEvidenceRepository = {
    get: async (id) => structuredClone(rejections.get(id)),
    async save(_tx, record) {
      const existing = rejections.get(record.rejectionId);
      if (existing !== undefined) {
        if (JSON.stringify(existing) !== JSON.stringify(record)) {
          throw new Error('EVIDENCE_REJECTION_ID_COLLISION');
        }
        return;
      }
      rejections.set(record.rejectionId, structuredClone(record));
    },
    async *list() {
      for (const id of [...rejections.keys()].sort()) {
        yield structuredClone(rejections.get(id)!);
      }
    },
  };
  return {
    evidence,
    checkpoints: checkpointRepository,
    rejections: rejectionRepository,
  };
}
