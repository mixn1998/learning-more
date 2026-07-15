import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, type FileHandle } from 'node:fs/promises';
import path from 'node:path';

export type ObservedProcess =
  | Readonly<{ state: 'missing' }>
  | Readonly<{ state: 'unavailable' }>
  | Readonly<{
      state: 'running';
      executablePath?: string;
      commandLine?: string;
    }>;

type HostLeaseRecord = Readonly<{
  schemaVersion: 1;
  instanceId: string;
  pid: number;
  executablePath: string;
  releaseRoot: string;
  startedAt: string;
}>;

export interface HostLease {
  readonly record: HostLeaseRecord;
  release(): Promise<void>;
}

function parseRecord(value: unknown): HostLeaseRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('host_lease_invalid');
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort().join(',');
  if (
    keys !== 'executablePath,instanceId,pid,releaseRoot,schemaVersion,startedAt' ||
    record.schemaVersion !== 1 ||
    typeof record.instanceId !== 'string' ||
    record.instanceId === '' ||
    typeof record.pid !== 'number' ||
    !Number.isInteger(record.pid) ||
    record.pid < 1 ||
    typeof record.executablePath !== 'string' ||
    record.executablePath === '' ||
    typeof record.releaseRoot !== 'string' ||
    record.releaseRoot === '' ||
    typeof record.startedAt !== 'string' ||
    Number.isNaN(Date.parse(record.startedAt))
  ) {
    throw new Error('host_lease_invalid');
  }
  return record as HostLeaseRecord;
}

function samePath(left: string | undefined, right: string): boolean {
  return (
    left !== undefined && path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase()
  );
}

function defaultObserveProcess(pid: number): Promise<ObservedProcess> {
  try {
    process.kill(pid, 0);
    return Promise.resolve({
      state: 'running',
      ...(pid === process.pid
        ? { executablePath: process.execPath, commandLine: process.argv.join(' ') }
        : {}),
    });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EPERM') return Promise.resolve({ state: 'running' });
    if (code === 'ESRCH') return Promise.resolve({ state: 'missing' });
    return Promise.resolve({ state: 'unavailable' });
  }
}

export async function acquireHostLease(options: {
  filePath: string;
  executablePath: string;
  releaseRoot: string;
  pid?: number;
  observeProcess?: (pid: number) => Promise<ObservedProcess>;
  now?: () => Date;
}): Promise<HostLease> {
  await mkdir(path.dirname(options.filePath), { recursive: true });
  const pid = options.pid ?? process.pid;
  const observeProcess = options.observeProcess ?? defaultObserveProcess;
  const record: HostLeaseRecord = {
    schemaVersion: 1,
    instanceId: randomUUID(),
    pid,
    executablePath: path.resolve(options.executablePath),
    releaseRoot: path.resolve(options.releaseRoot),
    startedAt: (options.now ?? (() => new Date()))().toISOString(),
  };
  let handle: FileHandle | undefined;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      handle = await open(options.filePath, 'wx');
      await handle.writeFile(`${JSON.stringify(record)}\n`, 'utf8');
      await handle.sync();
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const existing = parseRecord(JSON.parse(await readFile(options.filePath, 'utf8')) as unknown);
      const observed = await observeProcess(existing.pid);
      if (observed.state === 'unavailable') {
        throw new Error('host_process_observation_unavailable');
      }
      if (observed.state === 'running') {
        const sameOwner =
          samePath(observed.executablePath, existing.executablePath) &&
          (observed.commandLine?.toLowerCase().includes(existing.releaseRoot.toLowerCase()) ??
            false);
        throw new Error(sameOwner ? 'host_already_running' : 'host_lease_foreign_owner');
      }
      await rename(options.filePath, `${options.filePath}.stale.${Date.now()}`);
    }
  }
  if (handle === undefined) throw new Error('host_lease_acquire_failed');

  return {
    record,
    async release() {
      await handle?.close();
      handle = undefined;
      try {
        const current = parseRecord(
          JSON.parse(await readFile(options.filePath, 'utf8')) as unknown,
        );
        if (current.instanceId === record.instanceId) await rm(options.filePath, { force: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    },
  };
}
