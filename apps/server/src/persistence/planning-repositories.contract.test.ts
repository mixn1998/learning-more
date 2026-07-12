import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createInMemoryScheduleRepository,
  type ScheduleRepository,
} from '../modules/planning/ports/schedule-repository.js';
import { DataRoot } from './data-root.js';
import { createLocalFileScheduleRepository } from './planning-repositories.js';
import { createStorePaths, initializeStoreLayout } from './paths.js';
import { RepositoryVersionConflictError } from './repository-errors.js';
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

async function localFixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'learning-more-planning-repo-'));
  roots.push(directory);
  const dataRoot = DataRoot.create(directory);
  await initializeStoreLayout(createStorePaths(dataRoot));
  return {
    repository: createLocalFileScheduleRepository(dataRoot),
    unitOfWork: createUnitOfWork({ dataRoot }),
  };
}

async function contract(repository: ScheduleRepository, unitOfWork: UnitOfWork) {
  const item = {
    id: 'schedule_01',
    courseId: 'course_01',
    lessonId: 'lesson_01',
    startAt: '2026-07-13T01:00:00.000Z',
    endAt: '2026-07-13T02:00:00.000Z',
    timezoneAtCreation: 'Asia/Shanghai',
    source: 'manual' as const,
    status: 'scheduled' as const,
    createdAt: '2026-07-13T00:00:00.000Z',
    updatedAt: '2026-07-13T00:00:00.000Z',
    processedCommandIds: ['create_01'],
    resourceVersion: 0,
  };
  await unitOfWork.execute({ transactionId: 'tx_create_schedule' }, (tx) =>
    repository.save(tx, item, 0),
  );
  await expect(repository.get(item.id)).resolves.toMatchObject({
    resourceVersion: 1,
    lessonId: 'lesson_01',
  });
  await expect(
    unitOfWork.execute({ transactionId: 'tx_stale_schedule' }, (tx) =>
      repository.save(tx, item, 0),
    ),
  ).rejects.toBeInstanceOf(RepositoryVersionConflictError);
  const ids: string[] = [];
  for await (const saved of repository.list()) ids.push(saved.id);
  expect(ids).toEqual(['schedule_01']);
}

describe('ScheduleRepository contracts', () => {
  it('passes for InMemory', async () => {
    await contract(createInMemoryScheduleRepository(), memoryUnitOfWork);
  });

  it('passes for LocalFile', async () => {
    const fixture = await localFixture();
    await contract(fixture.repository, fixture.unitOfWork);
  });
});
