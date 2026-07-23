import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { SupplementarySession } from '../modules/learning-session/model/supplementary-session.js';
import { DataRoot } from './data-root.js';
import {
  createInMemorySupplementarySessionRepository,
  createLocalFileSupplementarySessionRepository,
  type SupplementarySessionRepository,
} from './supplementary-session-repository.js';
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

function session(id: string, lessonId: string, createdAt: string): SupplementarySession {
  return {
    id,
    courseId: 'course_01',
    lessonId,
    sourceFinalReviewId: 'review_01',
    status: 'active',
    messageIds: [],
    createdAt,
    updatedAt: createdAt,
    resourceVersion: 0,
  };
}

async function contract(repository: SupplementarySessionRepository, unitOfWork: UnitOfWork) {
  await unitOfWork.execute({ transactionId: 'tx_supplementary_02' }, (tx) =>
    repository.save(tx, session('supplementary_02', 'lesson_01', '2026-07-14T02:00:00.000Z'), 0),
  );
  await unitOfWork.execute({ transactionId: 'tx_supplementary_other' }, (tx) =>
    repository.save(tx, session('supplementary_other', 'lesson_02', '2026-07-14T00:00:00.000Z'), 0),
  );
  await unitOfWork.execute({ transactionId: 'tx_supplementary_01' }, (tx) =>
    repository.save(tx, session('supplementary_01', 'lesson_01', '2026-07-14T01:00:00.000Z'), 0),
  );

  const listed: string[] = [];
  for await (const item of repository.listByLesson('lesson_01')) listed.push(item.id);
  expect(listed).toEqual(['supplementary_01', 'supplementary_02']);
}

describe('SupplementarySessionRepository contracts', () => {
  it('lists one lesson deterministically in memory', async () => {
    await contract(createInMemorySupplementarySessionRepository(), memoryUnitOfWork);
  });

  it('lists one lesson deterministically from local files', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'learning-more-supplementary-repo-'));
    roots.push(directory);
    const dataRoot = DataRoot.create(directory);
    await initializeStoreLayout(createStorePaths(dataRoot));
    await contract(
      createLocalFileSupplementarySessionRepository(dataRoot),
      createUnitOfWork({ dataRoot }),
    );
  });
});
