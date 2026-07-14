import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { TeachingObservation } from '@learning-more/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createTeachingState,
  reduceTeachingState,
} from '../modules/interactive-teaching/implementation/teaching-state-reducer.js';
import type { TeachingLedgerRepository } from '../modules/interactive-teaching/ports/teaching-ledger-repository.js';
import { DataRoot } from './data-root.js';
import { createStorePaths, initializeStoreLayout } from './paths.js';
import {
  createInMemoryTeachingLedgerRepository,
  createLocalFileTeachingLedgerRepository,
} from './teaching-ledger-repositories.js';
import { createUnitOfWork, type UnitOfWork } from './unit-of-work.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const observation: TeachingObservation = {
  observationId: 'observation_1',
  schemaVersion: 1,
  lessonId: 'lesson_1',
  sessionId: 'session_1',
  turnSequence: 1,
  sourceMessageIds: ['message_user_1'],
  sourceSnapshotHash: 'a'.repeat(64),
  scope: {
    alignment: 'direct',
    relationRefs: ['knowledge:kp_1'],
    rationale: 'Current lesson reasoning.',
  },
  entries: [
    {
      entryId: 'entry_1',
      kind: 'learner_reasoning_behavior',
      summary: 'The learner connected two concepts through a shared mechanism.',
      knowledgePointRefs: ['knowledge:kp_1'],
      sourceRefs: ['message:message_user_1'],
      explicitness: 'ai_observed',
      resolvesEntryRefs: [],
      qualityFlags: ['direct', 'complete'],
    },
  ],
  observerVersion: 'teaching-observer@1',
  observedAt: '2026-07-14T00:00:00.000Z',
  status: 'active',
};

async function memoryFixture() {
  const tx = {
    stageJson: async () => undefined,
    stageText: async () => undefined,
    deleteOnCommit: async () => undefined,
  };
  return {
    repository: createInMemoryTeachingLedgerRepository(),
    unitOfWork: {
      async execute<T>(_request: unknown, work: (context: typeof tx) => Promise<T>) {
        return work(tx);
      },
    } as UnitOfWork,
  };
}

async function localFixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'learning-more-teaching-ledger-'));
  roots.push(directory);
  const dataRoot = DataRoot.create(directory);
  await initializeStoreLayout(createStorePaths(dataRoot));
  return {
    repository: createLocalFileTeachingLedgerRepository(dataRoot),
    unitOfWork: createUnitOfWork({ dataRoot }),
  };
}

function contract(
  name: string,
  fixture: () => Promise<{ repository: TeachingLedgerRepository; unitOfWork: UnitOfWork }>,
) {
  describe(name, () => {
    it('persists observation and reduced ledger as one versioned aggregate', async () => {
      const { repository, unitOfWork } = await fixture();
      const state = reduceTeachingState(
        createTeachingState({
          lessonId: 'lesson_1',
          sessionId: 'session_1',
          knowledgePointRefs: ['knowledge:kp_1'],
        }),
        observation,
      );
      await unitOfWork.execute({ transactionId: 'tx_teaching_1' }, (tx) =>
        repository.save(
          tx,
          {
            courseId: 'course_1',
            lessonId: 'lesson_1',
            sessionId: 'session_1',
            observations: [observation],
            checkpoints: [],
            state,
            resourceVersion: 0,
          },
          0,
        ),
      );

      await expect(repository.get('session_1')).resolves.toMatchObject({
        resourceVersion: 1,
        observations: [{ observationId: 'observation_1' }],
        state: { ledgerVersion: 1, evidenceCheckpoint: true },
      });
      const ids: string[] = [];
      for await (const record of repository.list({ courseId: 'course_1' })) {
        ids.push(record.sessionId);
      }
      expect(ids).toEqual(['session_1']);
    });

    it('rejects stale aggregate versions', async () => {
      const { repository, unitOfWork } = await fixture();
      const record = {
        courseId: 'course_1',
        lessonId: 'lesson_1',
        sessionId: 'session_1',
        observations: [],
        checkpoints: [],
        state: createTeachingState({
          lessonId: 'lesson_1',
          sessionId: 'session_1',
          knowledgePointRefs: ['knowledge:kp_1'],
        }),
        resourceVersion: 0,
      } as const;
      await unitOfWork.execute({ transactionId: 'tx_teaching_create' }, (tx) =>
        repository.save(tx, record, 0),
      );

      await expect(
        unitOfWork.execute({ transactionId: 'tx_teaching_stale' }, (tx) =>
          repository.save(tx, record, 0),
        ),
      ).rejects.toMatchObject({ code: 'version_conflict', currentVersion: 1 });
    });
  });
}

contract('InMemoryTeachingLedgerRepository', memoryFixture);
contract('LocalFileTeachingLedgerRepository', localFixture);
