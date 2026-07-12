import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { LearningFact } from '../modules/learning-facts/interface.js';
import type { FactRepository } from '../modules/learning-facts/ports/fact-repository.js';
import { createInMemoryFactRepository } from '../modules/learning-facts/ports/fact-repository.js';
import { DataRoot } from './data-root.js';
import { createLocalFileFactRepository } from './learning-facts-repositories.js';
import { createStorePaths, initializeStoreLayout } from './paths.js';
import { createUnitOfWork, type UnitOfWork } from './unit-of-work.js';

const roots: string[] = [];
const memoryTx = {
  stageJson: async () => undefined,
  stageText: async () => undefined,
  deleteOnCommit: async () => undefined,
};
const memoryUnitOfWork = {
  async execute<T>(_request: unknown, work: (context: typeof memoryTx) => Promise<T>) {
    return work(memoryTx);
  },
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const fact: LearningFact = {
  factId: 'fact_01',
  factType: 'LessonCompletedFact',
  subjectRefs: { courseId: 'course_01', lessonId: 'lesson_01' },
  occurredAt: '2026-07-13T01:00:00.000Z',
  recordedAt: '2026-07-13T01:00:01.000Z',
  sourceEventId: 'event_01',
  dataKeys: ['lesson.completed_at', 'completion.actual_seconds'],
  payload: { actualSeconds: 120 },
  schemaVersion: 1,
};

async function contract(repository: FactRepository, unitOfWork: UnitOfWork) {
  await expect(
    unitOfWork.execute({ transactionId: 'tx_fact_1' }, (tx) => repository.append(tx, fact)),
  ).resolves.toBe('appended');
  await expect(
    unitOfWork.execute({ transactionId: 'tx_fact_2' }, (tx) => repository.append(tx, fact)),
  ).resolves.toBe('duplicate');
  await expect(repository.get(fact.factId)).resolves.toEqual(fact);
  const facts: LearningFact[] = [];
  for await (const item of repository.list()) facts.push(item);
  expect(facts).toEqual([fact]);
}

describe('FactRepository contracts', () => {
  it('passes for InMemory', async () => {
    await contract(createInMemoryFactRepository(), memoryUnitOfWork);
  });

  it('passes for LocalFile', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'learning-more-facts-repo-'));
    roots.push(directory);
    const dataRoot = DataRoot.create(directory);
    await initializeStoreLayout(createStorePaths(dataRoot));
    await contract(createLocalFileFactRepository(dataRoot), createUnitOfWork({ dataRoot }));
  });
});
