import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createInMemoryWeeklyReportRepository,
  type WeeklyReportRepository,
} from '../modules/learning-facts/ports/weekly-report-repository.js';
import { DataRoot } from './data-root.js';
import { createStorePaths, initializeStoreLayout } from './paths.js';
import { createUnitOfWork, type UnitOfWork } from './unit-of-work.js';
import { createLocalFileWeeklyReportRepository } from './weekly-report-repositories.js';

const roots: string[] = [];
const tx = {
  stageJson: async () => undefined,
  stageText: async () => undefined,
  deleteOnCommit: async () => undefined,
};
const memoryUnitOfWork = {
  async execute<T>(_request: unknown, work: (context: typeof tx) => Promise<T>) {
    return work(tx);
  },
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function contract(repository: WeeklyReportRepository, unitOfWork: UnitOfWork) {
  const record = {
    localWeekKey: '2026-W28',
    timezone: 'Asia/Shanghai',
    startLocalDate: '2026-07-05',
    endLocalDate: '2026-07-12',
    state: 'generating' as const,
    factSnapshot: [],
    factSnapshotHash: 'a'.repeat(64),
    metricDefinitionVersion: 1,
    generationTaskId: 'task_01',
    createdAt: '2026-07-12T00:00:00.000Z',
    updatedAt: '2026-07-12T00:00:00.000Z',
    resourceVersion: 0,
  };
  await unitOfWork.execute({ transactionId: 'tx_week_create' }, (context) =>
    repository.save(context, record, 0),
  );
  await expect(repository.get(record.localWeekKey)).resolves.toMatchObject({
    state: 'generating',
    resourceVersion: 1,
  });
  const stored = (await repository.get(record.localWeekKey))!;
  await unitOfWork.execute({ transactionId: 'tx_week_finalize' }, (context) =>
    repository.save(
      context,
      {
        ...stored,
        state: 'finalized',
        artifactRef: 'weekly_report_2026-W28',
        contentSha256: 'b'.repeat(64),
      },
      stored.resourceVersion,
    ),
  );
  const finalized = (await repository.get(record.localWeekKey))!;
  await expect(
    unitOfWork.execute({ transactionId: 'tx_week_overwrite' }, (context) =>
      repository.save(context, finalized, finalized.resourceVersion),
    ),
  ).rejects.toMatchObject({ code: 'weekly_report_immutable' });

  await unitOfWork.execute({ transactionId: 'tx_week_repair_window' }, (context) =>
    repository.replaceInvalidWindow(
      context,
      {
        ...finalized,
        startLocalDate: '2026-07-06',
        endLocalDate: '2026-07-13',
        state: 'generating',
        generationTaskId: 'task_02',
      },
      finalized.resourceVersion,
    ),
  );
  const repaired = (await repository.get(record.localWeekKey))!;
  expect(repaired).toMatchObject({
    startLocalDate: '2026-07-06',
    endLocalDate: '2026-07-13',
    state: 'generating',
    resourceVersion: 3,
  });
  await expect(
    unitOfWork.execute({ transactionId: 'tx_week_repair_same_window' }, (context) =>
      repository.replaceInvalidWindow(context, repaired, repaired.resourceVersion),
    ),
  ).rejects.toThrow('weekly_report_window_unchanged');
}

describe('WeeklyReportRepository contracts', () => {
  it('passes for InMemory', async () => {
    await contract(createInMemoryWeeklyReportRepository(), memoryUnitOfWork);
  });

  it('passes for LocalFile', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'learning-more-weekly-repo-'));
    roots.push(directory);
    const dataRoot = DataRoot.create(directory);
    await initializeStoreLayout(createStorePaths(dataRoot));
    await contract(createLocalFileWeeklyReportRepository(dataRoot), createUnitOfWork({ dataRoot }));
  });
});
