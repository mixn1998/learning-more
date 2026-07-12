import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';

import { DataRoot } from './data-root.js';
import { encodeJson } from './json-codec.js';

export class StoreWriteLeaseError extends Error {
  readonly code = 'store_write_lease_held';

  constructor() {
    super('store_write_lease_held');
    this.name = 'StoreWriteLeaseError';
  }
}

export interface StoreWriteLease {
  readonly leasePath: string;
  release(): Promise<void>;
}

export interface StoreWriteLeaseOwner {
  readonly instanceId: string;
  readonly processId: number;
}

export async function acquireStoreWriteLease(
  dataRoot: DataRoot,
  owner: StoreWriteLeaseOwner = { instanceId: randomUUID(), processId: process.pid },
): Promise<StoreWriteLease> {
  const locksDirectory = dataRoot.resolve('locks');
  const leasePath = path.join(locksDirectory, 'store-write.lock');
  const token = randomUUID();
  await mkdir(locksDirectory, { recursive: true });
  let handle;
  try {
    handle = await open(leasePath, 'wx');
    await handle.writeFile(
      encodeJson({
        schemaVersion: 1,
        token,
        instanceId: owner.instanceId,
        processId: owner.processId,
        acquiredAt: new Date().toISOString(),
      }),
      'utf8',
    );
    await handle.sync();
  } catch (error) {
    await handle?.close();
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new StoreWriteLeaseError();
    throw error;
  }
  await handle.close();

  let released = false;
  return {
    leasePath,
    async release() {
      if (released) return;
      const current = JSON.parse(await readFile(leasePath, 'utf8')) as { token?: unknown };
      if (current.token !== token) throw new StoreWriteLeaseError();
      await unlink(leasePath);
      released = true;
    },
  };
}
