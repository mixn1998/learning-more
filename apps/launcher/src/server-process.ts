import { spawn, type SpawnOptions } from 'node:child_process';
import { EventEmitter } from 'node:events';

export type ServerProcessRequest = Readonly<{
  executable: string;
  arguments: readonly string[];
  cwd: string;
  environment: NodeJS.ProcessEnv;
}>;

export type ManagedChildProcess = Readonly<{
  pid: number;
  kill(signal?: NodeJS.Signals | number): boolean;
  once(event: 'exit', listener: (...arguments_: unknown[]) => void): unknown;
}>;

export type SpawnServerProcess = (
  executable: string,
  arguments_: readonly string[],
  options: SpawnOptions,
) => Readonly<{
  pid?: number | undefined;
  kill(signal?: NodeJS.Signals | number): boolean;
  once(event: 'exit', listener: (...arguments_: unknown[]) => void): unknown;
}>;

const spawnServerProcess: SpawnServerProcess = (executable, arguments_, options) =>
  spawn(executable, arguments_, options);

export function startServerProcess(
  request: ServerProcessRequest,
  spawnProcess: SpawnServerProcess = spawnServerProcess,
): ManagedChildProcess {
  const child = spawnProcess(request.executable, [...request.arguments], {
    cwd: request.cwd,
    env: request.environment,
    shell: false,
    windowsHide: true,
    stdio: 'ignore',
  });
  if (child.pid === undefined) throw new Error('server_process_start_failed');
  return child as ManagedChildProcess;
}

export function adoptVerifiedServerProcess(pid: number): ManagedChildProcess {
  if (!Number.isInteger(pid) || pid < 1) throw new Error('server_process_pid_invalid');
  const events = new EventEmitter();
  const timer = setInterval(() => {
    try {
      process.kill(pid, 0);
    } catch {
      clearInterval(timer);
      events.emit('exit', null, null);
    }
  }, 100);
  timer.unref();
  return {
    pid,
    kill(signal) {
      try {
        process.kill(pid, signal);
        return true;
      } catch {
        return false;
      }
    },
    once(event, listener) {
      return events.once(event, listener);
    },
  };
}

export async function terminateVerifiedChild<
  TManifest extends Readonly<{ pid: number }>,
  TObserved,
>(
  input: Readonly<{
    child: ManagedChildProcess;
    manifest: TManifest;
    observeIdentity(): Promise<TObserved>;
    verifyIdentity(
      manifest: TManifest,
      observed: TObserved,
    ): Readonly<{ healthy: boolean; mismatches: readonly unknown[] }>;
    timeoutMs?: number;
  }>,
): Promise<
  | Readonly<{ terminated: true }>
  | Readonly<{ terminated: false; reason: 'child_pid_mismatch' | 'identity_mismatch' | 'timeout' }>
> {
  if (input.child.pid !== input.manifest.pid) {
    return { terminated: false, reason: 'child_pid_mismatch' };
  }
  const observed = await input.observeIdentity();
  if (!input.verifyIdentity(input.manifest, observed).healthy) {
    return { terminated: false, reason: 'identity_mismatch' };
  }

  const exited = new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => resolve(false), input.timeoutMs ?? 10_000);
    input.child.once('exit', () => {
      clearTimeout(timeout);
      resolve(true);
    });
  });
  input.child.kill();
  return (await exited) ? { terminated: true } : { terminated: false, reason: 'timeout' };
}
