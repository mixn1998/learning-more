import type { TransactionContext } from '../../../persistence/unit-of-work.js';
import type { CandidateCompilationResult } from '../implementation/outline-compiler.js';

export type CompiledCandidate = Extract<CandidateCompilationResult, { valid: true }>['candidate'];

export interface CandidateOutlineVersion {
  readonly id: string;
  readonly outlineSessionId: string;
  readonly parentVersionId?: string;
  readonly generationTaskId: string;
  readonly draftArtifactRef: string;
  readonly candidate: CompiledCandidate;
  readonly createdAt: string;
  readonly resourceVersion: number;
}

export interface CandidateVersionRepository {
  get(candidateVersionId: string): Promise<CandidateOutlineVersion | undefined>;
  save(tx: TransactionContext, version: CandidateOutlineVersion, expectedVersion: 0): Promise<void>;
  listBySession(outlineSessionId: string): AsyncIterable<CandidateOutlineVersion>;
}
