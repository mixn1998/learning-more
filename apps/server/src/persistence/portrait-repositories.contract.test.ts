import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { DataRoot } from './data-root.js';
import { createStorePaths, initializeStoreLayout } from './paths.js';
import { createLocalFilePortraitRepository } from './portrait-repositories.js';
import { recoverTransactions } from './recover-transactions.js';
import { createUnitOfWork } from './unit-of-work.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('LocalFilePortraitRepository', () => {
  it('recovers a completed version and current cursor as one transaction', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'learning-more-portrait-recovery-'));
    roots.push(directory);
    const dataRoot = DataRoot.create(directory);
    await initializeStoreLayout(createStorePaths(dataRoot));
    const repository = createLocalFilePortraitRepository(dataRoot);
    let crashed = false;
    const crashing = createUnitOfWork({
      dataRoot,
      faultInjector(point) {
        if (!crashed && point === 'after-apply:0') {
          crashed = true;
          throw new Error('simulated cursor switch crash');
        }
      },
    });
    const version = {
      versionId: 'portrait_01',
      manifestId: 'manifest_01',
      state: 'completed' as const,
      title: 'Portrait',
      summary: 'Summary',
      claims: [],
      createdAt: '2026-07-13T00:00:00.000Z',
      updatedAt: '2026-07-13T00:01:00.000Z',
      completedAt: '2026-07-13T00:01:00.000Z',
      resourceVersion: 0,
    };
    await expect(
      crashing.execute({ transactionId: 'tx_portrait_cursor' }, async (tx) => {
        await repository.saveVersion(tx, version, 0);
        await repository.saveCurrent(
          tx,
          {
            currentVersionId: version.versionId,
            updatedAt: version.completedAt,
            resourceVersion: 0,
          },
          0,
        );
      }),
    ).rejects.toThrow('simulated cursor switch crash');
    await recoverTransactions(dataRoot);
    await expect(repository.getVersion(version.versionId)).resolves.toMatchObject({
      state: 'completed',
    });
    await expect(repository.getCurrent()).resolves.toMatchObject({
      currentVersionId: version.versionId,
    });
  });
});
