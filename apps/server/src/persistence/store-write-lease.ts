import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
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

export interface StoreWriteLeaseOptions {
  readonly isProcessAlive?: (processId: number) => boolean;
}

function processIsAlive(processId: number): boolean {
  if (!Number.isInteger(processId) || processId < 1) return false;
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

async function retireDeadLease(
  leasePath: string,
  token: string,
  isProcessAlive: (processId: number) => boolean,
): Promise<boolean> {
  let current: unknown;
  try {
    current = JSON.parse(await readFile(leasePath, 'utf8')) as unknown;
  } catch {
    return false;
  }
  if (typeof current !== 'object' || current === null || Array.isArray(current)) return false;
  const processId = (current as Record<string, unknown>).processId;
  const previousToken = (current as Record<string, unknown>).token;
  if (
    typeof processId !== 'number' ||
    typeof previousToken !== 'string' ||
    isProcessAlive(processId)
  ) {
    return false;
  }

  const retiredPath = `${leasePath}.stale.${token}`;
  try {
    await rename(leasePath, retiredPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true;
    return false;
  }
  try {
    const retired = JSON.parse(await readFile(retiredPath, 'utf8')) as { token?: unknown };
    if (retired.token !== previousToken) {
      await rename(retiredPath, leasePath).catch(() => undefined);
      return false;
    }
  } catch {
    await rename(retiredPath, leasePath).catch(() => undefined);
    return false;
  }
  await unlink(retiredPath).catch(() => undefined);
  return true;
}

export async function acquireStoreWriteLease(
  dataRoot: DataRoot,
  owner: StoreWriteLeaseOwner = { instanceId: randomUUID(), processId: process.pid },
  options: StoreWriteLeaseOptions = {},
): Promise<StoreWriteLease> {
  const locksDirectory = dataRoot.resolve('locks');
  const leasePath = path.join(locksDirectory, 'store-write.lock');
  const token = randomUUID();
  await mkdir(locksDirectory, { recursive: true });
  let handle;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      handle = await open(leasePath, 'wx');
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const retired = await retireDeadLease(
        leasePath,
        token,
        options.isProcessAlive ?? processIsAlive,
      );
      if (!retired || attempt === 1) throw new StoreWriteLeaseError();
    }
  }
  if (handle === undefined) throw new StoreWriteLeaseError();
  try {
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
    await handle.close();
    await unlink(leasePath).catch(() => undefined);
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
