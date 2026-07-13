import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rm } from 'node:fs/promises';
import path from 'node:path';

export interface StoreMaintenanceLease {
  release(): Promise<void>;
}

export async function acquireStoreMaintenanceLease(
  storePath: string,
  owner: string,
  timeoutMs = 10_000,
): Promise<StoreMaintenanceLease> {
  const lockPath = path.join(storePath, 'locks', 'store-write.lock');
  await mkdir(path.dirname(lockPath), { recursive: true });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const handle = await open(lockPath, 'wx');
      const token = randomUUID();
      await handle.writeFile(
        `${JSON.stringify({
          schemaVersion: 1,
          token,
          instanceId: owner,
          processId: process.pid,
          acquiredAt: new Date().toISOString(),
        })}\n`,
      );
      await handle.sync();
      await handle.close();
      let released = false;
      return {
        async release() {
          if (released) return;
          const current = JSON.parse(await readFile(lockPath, 'utf8')) as { token?: unknown };
          if (current.token !== token) throw new Error('maintenance_lease_lost');
          await rm(lockPath, { force: true });
          released = true;
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error('maintenance_lease_timeout');
}
