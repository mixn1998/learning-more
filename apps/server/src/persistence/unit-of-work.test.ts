import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { DataRoot } from './data-root.js';
import { createStorePaths, initializeStoreLayout } from './paths.js';
import { acquireStoreWriteLease } from './store-write-lease.js';
import { createUnitOfWork } from './unit-of-work.js';

const temporaryRoots: string[] = [];

async function temporaryDataRoot(): Promise<DataRoot> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'learning-more-uow-'));
  temporaryRoots.push(directory);
  const root = DataRoot.create(directory);
  await initializeStoreLayout(createStorePaths(root));
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe('UnitOfWork', () => {
  it('atomically commits staged JSON, text, and deletion operations', async () => {
    const root = await temporaryDataRoot();
    await mkdir(path.join(root.absolutePath, 'work'), { recursive: true });
    await writeFile(path.join(root.absolutePath, 'work', 'delete.txt'), 'obsolete', 'utf8');
    const unitOfWork = createUnitOfWork({ dataRoot: root });

    const result = await unitOfWork.execute({ transactionId: 'tx_01' }, async (tx) => {
      await tx.stageJson('work/state.json', { b: 2, a: 1 });
      await tx.stageText('work/content.md', '# 内容\n');
      await tx.deleteOnCommit('work/delete.txt');
      return 'committed';
    });

    expect(result).toBe('committed');
    await expect(
      readFile(path.join(root.absolutePath, 'work', 'state.json'), 'utf8'),
    ).resolves.toBe('{"a":1,"b":2}\n');
    await expect(
      readFile(path.join(root.absolutePath, 'work', 'content.md'), 'utf8'),
    ).resolves.toBe('# 内容\n');
    await expect(
      readFile(path.join(root.absolutePath, 'work', 'delete.txt'), 'utf8'),
    ).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('does not let a second writer remove or replace an active lease', async () => {
    const root = await temporaryDataRoot();
    const first = await acquireStoreWriteLease(root, { instanceId: 'instance-a', processId: 101 });

    await expect(
      acquireStoreWriteLease(root, { instanceId: 'instance-b', processId: 202 }),
    ).rejects.toMatchObject({ code: 'store_write_lease_held' });
    await expect(readFile(first.leasePath, 'utf8')).resolves.toContain('instance-a');

    await first.release();
  });
});
