import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { DataRoot } from './data-root.js';
import { createStorePaths, initializeStoreLayout } from './paths.js';
import { recoverTransactions } from './recover-transactions.js';
import { createUnitOfWork, type TransactionFaultPoint } from './unit-of-work.js';

const faultPoints: readonly TransactionFaultPoint[] = [
  'journal:preparing',
  'journal:prepared',
  'journal:committing',
  'before-apply:0',
  'after-backup:0',
  'after-apply:0',
  'before-apply:1',
  'after-backup:1',
  'after-apply:1',
  'journal:committed',
  'before-cleanup',
  'after-cleanup',
];

async function readPair(root: DataRoot): Promise<readonly [string, string]> {
  return Promise.all([
    readFile(path.join(root.absolutePath, 'work', 'a.txt'), 'utf8'),
    readFile(path.join(root.absolutePath, 'work', 'b.txt'), 'utf8'),
  ]);
}

describe('transaction recovery', () => {
  it('recovers 100 injected crashes to a complete old or complete new state', async () => {
    for (let iteration = 0; iteration < 100; iteration += 1) {
      const directory = await mkdtemp(path.join(os.tmpdir(), 'learning-more-recovery-'));
      try {
        const root = DataRoot.create(directory);
        await initializeStoreLayout(createStorePaths(root));
        await mkdir(path.join(root.absolutePath, 'work'), { recursive: true });
        await writeFile(path.join(root.absolutePath, 'work', 'a.txt'), 'old-a', 'utf8');
        await writeFile(path.join(root.absolutePath, 'work', 'b.txt'), 'old-b', 'utf8');
        const selectedPoint = faultPoints[iteration % faultPoints.length];
        const unitOfWork = createUnitOfWork({
          dataRoot: root,
          faultInjector(point) {
            if (point === selectedPoint) throw new Error(`SIMULATED_CRASH:${point}`);
          },
        });

        await expect(
          unitOfWork.execute({ transactionId: `tx_${iteration}` }, async (tx) => {
            await tx.stageText('work/a.txt', 'new-a');
            await tx.stageText('work/b.txt', 'new-b');
          }),
        ).rejects.toThrow(`SIMULATED_CRASH:${selectedPoint}`);

        await recoverTransactions(root);

        expect(await readPair(root)).toEqual(
          selectedPoint === 'journal:preparing' || selectedPoint === 'journal:prepared'
            ? ['old-a', 'old-b']
            : ['new-a', 'new-b'],
        );
      } finally {
        await rm(directory, { force: true, recursive: true });
      }
    }
  }, 60_000);

  it('refuses to guess how to recover an unknown journal schema', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'learning-more-recovery-schema-'));
    try {
      const root = DataRoot.create(directory);
      await initializeStoreLayout(createStorePaths(root));
      const transactionDirectory = path.join(
        root.absolutePath,
        'transactions',
        'prepared',
        'tx_unknown',
      );
      await mkdir(transactionDirectory, { recursive: true });
      await writeFile(
        path.join(transactionDirectory, 'journal.json'),
        '{"schemaVersion":999,"state":"prepared"}\n',
        'utf8',
      );

      await expect(recoverTransactions(root)).rejects.toMatchObject({
        code: 'store_version_unsupported',
      });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
