import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { parseCandidateEvidence } from '../modules/profile-evidence/implementation/candidate-evidence.js';
import {
  createInMemoryEvidenceRepositories,
  type EvidenceRepositories,
} from '../modules/profile-evidence/ports/evidence-repository.js';
import { DataRoot } from './data-root.js';
import { createStorePaths, initializeStoreLayout } from './paths.js';
import { createLocalFileEvidenceRepositories } from './profile-evidence-repositories.js';
import { createUnitOfWork, type UnitOfWork } from './unit-of-work.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function evidence(id: string, dedupKey = 'a'.repeat(64)) {
  return parseCandidateEvidence(
    {
      evidenceId: id,
      claimDimension: 'learning.recovery_behavior',
      sourceGroup: 'behavior',
      sourceGroupId: 'lesson:lesson_01',
      dependentSourceGroupIds: [],
      sourceFactType: 'LessonRestoredFact',
      sourceRefs: ['fact:fact_01'],
      dataKeys: ['lesson.restored_at'],
      observedAt: '2026-07-12T23:00:00.000Z',
      strength: { score: 2, rationale: 'Explicit restore after an evidenced abandon.' },
      polarity: 'supporting',
      extractorVersion: 'behavior@1',
      dedupKey,
      status: 'active',
      resourceVersion: 0,
    },
    new Date('2026-07-13T00:00:00.000Z'),
  );
}

async function localFixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'learning-more-evidence-'));
  roots.push(directory);
  const dataRoot = DataRoot.create(directory);
  await initializeStoreLayout(createStorePaths(dataRoot));
  return {
    repositories: createLocalFileEvidenceRepositories(dataRoot),
    unitOfWork: createUnitOfWork({ dataRoot }),
  };
}

async function memoryFixture() {
  const tx = {
    stageJson: async () => undefined,
    stageText: async () => undefined,
    deleteOnCommit: async () => undefined,
  };
  return {
    repositories: createInMemoryEvidenceRepositories(),
    unitOfWork: {
      async execute<T>(_request: unknown, work: (context: typeof tx) => Promise<T>) {
        return work(tx);
      },
    } as UnitOfWork,
  };
}

function repositoryContract(
  name: string,
  fixture: () => Promise<{ repositories: EvidenceRepositories; unitOfWork: UnitOfWork }>,
) {
  describe(name, () => {
    it('persists evidence and checkpoint atomically with deterministic iteration', async () => {
      const { repositories, unitOfWork } = await fixture();
      await unitOfWork.execute({ transactionId: 'tx_evidence_01' }, async (tx) => {
        await repositories.evidence.save(tx, evidence('evidence_b', 'b'.repeat(64)), 0);
        await repositories.evidence.save(tx, evidence('evidence_a', 'a'.repeat(64)), 0);
        await repositories.checkpoints.save(
          tx,
          {
            checkpointId: 'checkpoint_behavior',
            sourceGroup: 'behavior',
            lastFactId: 'fact_01',
            extractorVersion: 'behavior@1',
            outputChecksum: 'c'.repeat(64),
            processedFactCount: 1,
            rejectedFactCount: 0,
            updatedAt: '2026-07-13T00:00:00.000Z',
            resourceVersion: 0,
          },
          0,
        );
      });
      const ids: string[] = [];
      for await (const item of repositories.evidence.list()) ids.push(item.evidenceId);
      expect(ids).toEqual(['evidence_a', 'evidence_b']);
      await expect(repositories.checkpoints.get('checkpoint_behavior')).resolves.toMatchObject({
        lastFactId: 'fact_01',
        resourceVersion: 1,
      });
    });

    it('rejects a duplicate dedup key and supports explicit status versioning', async () => {
      const { repositories, unitOfWork } = await fixture();
      await unitOfWork.execute({ transactionId: 'tx_evidence_01' }, (tx) =>
        repositories.evidence.save(tx, evidence('evidence_01'), 0),
      );
      await expect(
        unitOfWork.execute({ transactionId: 'tx_evidence_duplicate' }, (tx) =>
          repositories.evidence.save(tx, evidence('evidence_02'), 0),
        ),
      ).rejects.toMatchObject({ code: 'evidence_duplicate' });
      const current = await repositories.evidence.get('evidence_01');
      await unitOfWork.execute({ transactionId: 'tx_evidence_retract' }, (tx) =>
        repositories.evidence.save(tx, { ...current!, status: 'retracted' }, 1),
      );
      await expect(repositories.evidence.get('evidence_01')).resolves.toMatchObject({
        status: 'retracted',
        resourceVersion: 2,
      });
    });
  });
}

repositoryContract('InMemoryEvidenceRepositories', memoryFixture);
repositoryContract('LocalFileEvidenceRepositories', localFixture);
