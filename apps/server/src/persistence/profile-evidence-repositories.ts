import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import type {
  CandidateEvidence,
  RejectedEvidenceRecord,
  SourceCheckpoint,
} from '../modules/profile-evidence/interface.js';
import { CandidateEvidenceSchema } from '../modules/profile-evidence/implementation/candidate-evidence.js';
import {
  RejectedEvidenceRecordSchema,
  SourceCheckpointSchema,
} from '../modules/profile-evidence/implementation/source-checkpoint.js';
import {
  EvidenceDuplicateError,
  type CandidateEvidenceRepository,
  type EvidenceRepositories,
  type RejectedEvidenceRepository,
  type SourceCheckpointRepository,
} from '../modules/profile-evidence/ports/evidence-repository.js';
import { DataRoot, assertSafePathSegment } from './data-root.js';
import { checksumJson, decodeAggregateDocument } from './json-codec.js';
import { RepositoryVersionConflictError } from './repository-errors.js';

function shard(id: string): string {
  return createHash('sha256').update(id, 'utf8').digest('hex').slice(0, 2);
}

function relativePath(kind: 'candidates' | 'checkpoints' | 'rejections', id: string): string {
  assertSafePathSegment(id);
  return `portrait-evidence/${kind}/${shard(id)}/${id}.json`;
}

async function listIds(root: string): Promise<string[]> {
  const ids: string[] = [];
  for (const shardEntry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!shardEntry.isDirectory()) continue;
    for (const file of await readdir(path.join(root, shardEntry.name), { withFileTypes: true })) {
      if (file.isFile() && file.name.endsWith('.json')) ids.push(file.name.slice(0, -5));
    }
  }
  return ids.sort();
}

function document(
  entityType: string,
  entityId: string,
  data: CandidateEvidence | SourceCheckpoint | RejectedEvidenceRecord,
) {
  const now = 'updatedAt' in data ? data.updatedAt : new Date().toISOString();
  return {
    schema: `learning-more/${entityType}`,
    schemaVersion: 1,
    entityType,
    entityId,
    resourceVersion: data.resourceVersion,
    createdAt: now,
    updatedAt: now,
    contentSha256: checksumJson(data),
    data,
  };
}

export function createLocalFileEvidenceRepositories(dataRoot: DataRoot): EvidenceRepositories {
  const evidenceRoot = path.join(dataRoot.absolutePath, 'portrait-evidence', 'candidates');
  const checkpointRoot = path.join(dataRoot.absolutePath, 'portrait-evidence', 'checkpoints');
  const rejectionRoot = path.join(dataRoot.absolutePath, 'portrait-evidence', 'rejections');
  const evidence: CandidateEvidenceRepository = {
    async get(evidenceId: string) {
      try {
        return decodeAggregateDocument(
          await readFile(
            path.join(dataRoot.absolutePath, relativePath('candidates', evidenceId)),
            'utf8',
          ),
          CandidateEvidenceSchema,
        ).data as CandidateEvidence;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
      }
    },
    async findByDedupKey(dedupKey: string) {
      for await (const candidate of evidence.list()) {
        if (candidate.dedupKey === dedupKey) return candidate;
      }
      return undefined;
    },
    async save(tx, candidate: CandidateEvidence, expectedVersion: number) {
      const currentVersion = (await evidence.get(candidate.evidenceId))?.resourceVersion ?? 0;
      if (currentVersion !== expectedVersion || candidate.resourceVersion !== expectedVersion) {
        throw new RepositoryVersionConflictError(currentVersion);
      }
      const duplicate = await evidence.findByDedupKey(candidate.dedupKey);
      if (duplicate !== undefined && duplicate.evidenceId !== candidate.evidenceId) {
        throw new EvidenceDuplicateError(duplicate.evidenceId);
      }
      const stored = { ...candidate, resourceVersion: expectedVersion + 1 };
      await tx.stageJson(
        relativePath('candidates', candidate.evidenceId),
        document('candidate-evidence', candidate.evidenceId, stored),
      );
    },
    async *list() {
      for (const id of await listIds(evidenceRoot)) {
        const candidate = await evidence.get(id);
        if (candidate !== undefined) yield candidate;
      }
    },
  };
  const checkpoints: SourceCheckpointRepository = {
    async get(checkpointId: string) {
      try {
        return decodeAggregateDocument(
          await readFile(
            path.join(dataRoot.absolutePath, relativePath('checkpoints', checkpointId)),
            'utf8',
          ),
          SourceCheckpointSchema,
        ).data as SourceCheckpoint;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
      }
    },
    async save(tx, checkpoint: SourceCheckpoint, expectedVersion: number) {
      const currentVersion = (await checkpoints.get(checkpoint.checkpointId))?.resourceVersion ?? 0;
      if (currentVersion !== expectedVersion || checkpoint.resourceVersion !== expectedVersion) {
        throw new RepositoryVersionConflictError(currentVersion);
      }
      const stored = { ...checkpoint, resourceVersion: expectedVersion + 1 };
      await tx.stageJson(
        relativePath('checkpoints', checkpoint.checkpointId),
        document('evidence-checkpoint', checkpoint.checkpointId, stored),
      );
    },
    async *list() {
      for (const id of await listIds(checkpointRoot)) {
        const checkpoint = await checkpoints.get(id);
        if (checkpoint !== undefined) yield checkpoint;
      }
    },
  };
  const rejections: RejectedEvidenceRepository = {
    async get(rejectionId) {
      try {
        return decodeAggregateDocument(
          await readFile(
            path.join(dataRoot.absolutePath, relativePath('rejections', rejectionId)),
            'utf8',
          ),
          RejectedEvidenceRecordSchema,
        ).data as RejectedEvidenceRecord;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
      }
    },
    async save(tx, record) {
      const existing = await rejections.get(record.rejectionId);
      if (existing !== undefined) {
        if (JSON.stringify(existing) !== JSON.stringify(record)) {
          throw new Error('EVIDENCE_REJECTION_ID_COLLISION');
        }
        return;
      }
      await tx.stageJson(
        relativePath('rejections', record.rejectionId),
        document('evidence-rejection', record.rejectionId, record),
      );
    },
    async *list() {
      for (const id of await listIds(rejectionRoot)) {
        const record = await rejections.get(id);
        if (record !== undefined) yield record;
      }
    },
  };
  return { evidence, checkpoints, rejections };
}
