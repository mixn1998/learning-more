import { spawn, type ChildProcess } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { ObservedProcess } from './host-lease.js';
import type { ManagedLauncherProcess } from './supervisor.js';

function samePath(left: string | undefined, right: string): boolean {
  return (
    left !== undefined && path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase()
  );
}

export function commandMatchesLauncher(
  commandLine: string | undefined,
  acceptedCommandMarkers: readonly string[],
): boolean {
  if (commandLine === undefined) return false;
  const normalizedCommand = commandLine.replaceAll('/', '\\').toLowerCase();
  return acceptedCommandMarkers.some((marker) =>
    normalizedCommand.includes(marker.replaceAll('/', '\\').toLowerCase()),
  );
}

async function existingLauncherPid(runtimeDirectory: string): Promise<number | undefined> {
  try {
    const value = JSON.parse(
      await readFile(path.join(runtimeDirectory, 'launcher.lock'), 'utf8'),
    ) as Record<string, unknown>;
    return typeof value.pid === 'number' && Number.isInteger(value.pid) && value.pid > 0
      ? value.pid
      : undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

function adoptedProcess(options: {
  pid: number;
  acceptedCommandMarkers: readonly string[];
  observeProcess(pid: number): Promise<ObservedProcess>;
}): ManagedLauncherProcess {
  let stopped = false;
  const waitForExit = new Promise<Readonly<{ exitCode: number | null; signal: string | null }>>(
    (resolve) => {
      const timer = setInterval(() => {
        void options.observeProcess(options.pid).then((observed) => {
          if (observed.state === 'unavailable') return;
          const stillOwner =
            observed.state === 'running' &&
            samePath(observed.executablePath, process.execPath) &&
            commandMatchesLauncher(observed.commandLine, options.acceptedCommandMarkers);
          if (!stillOwner) {
            clearInterval(timer);
            resolve({ exitCode: stopped ? 0 : null, signal: stopped ? 'SIGTERM' : null });
          }
        });
      }, 500);
    },
  );
  return {
    pid: options.pid,
    waitForExit,
    async stop() {
      stopped = true;
      try {
        process.kill(options.pid, 'SIGTERM');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
      }
      await waitForExit;
    },
  };
}

function spawnedProcess(child: ChildProcess): ManagedLauncherProcess {
  if (child.pid === undefined) throw new Error('launcher_spawn_failed');
  let stopped = false;
  const waitForExit = new Promise<Readonly<{ exitCode: number | null; signal: string | null }>>(
    (resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (exitCode, signal) => resolve({ exitCode, signal }));
    },
  );
  return {
    pid: child.pid,
    waitForExit,
    async stop() {
      stopped = true;
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      await waitForExit.catch((error) => {
        if (!stopped) throw error;
      });
    },
  };
}

export async function startOrAdoptLauncher(options: {
  projectRoot: string;
  runtimeDirectory: string;
  dataRoot: string;
  secretDirectory: string;
  launcherEntry: string;
  serverEntry: string;
  webRoot: string;
  buildId: string;
  activationRequestPath?: string;
  activationStatusPath?: string;
  acceptedCommandMarkers?: readonly string[];
  observeProcess(pid: number): Promise<ObservedProcess>;
}): Promise<ManagedLauncherProcess> {
  const acceptedCommandMarkers = options.acceptedCommandMarkers ?? [options.launcherEntry];
  const existingPid = await existingLauncherPid(options.runtimeDirectory);
  if (existingPid !== undefined) {
    const observed = await options.observeProcess(existingPid);
    if (observed.state === 'unavailable') {
      throw new Error('launcher_process_observation_unavailable');
    }
    if (observed.state === 'running') {
      const verified =
        samePath(observed.executablePath, process.execPath) &&
        commandMatchesLauncher(observed.commandLine, acceptedCommandMarkers);
      if (!verified) throw new Error('launcher_existing_identity_mismatch');
      return adoptedProcess({
        pid: existingPid,
        acceptedCommandMarkers,
        observeProcess: options.observeProcess,
      });
    }
  }

  return spawnedProcess(
    spawn(process.execPath, [options.launcherEntry], {
      cwd: options.projectRoot,
      env: {
        ...process.env,
        LEARNING_MORE_PROJECT_ROOT: options.projectRoot,
        LEARNING_MORE_RUNTIME_DIR: options.runtimeDirectory,
        LEARNING_MORE_DATA_ROOT: options.dataRoot,
        LEARNING_MORE_SECRET_DIR: options.secretDirectory,
        LEARNING_MORE_SERVER_ENTRY: options.serverEntry,
        LEARNING_MORE_WEB_ROOT: options.webRoot,
        LEARNING_MORE_WEB_URL: 'http://127.0.0.1:43119',
        LEARNING_MORE_ALLOWED_ORIGIN: 'http://127.0.0.1:43119',
        LEARNING_MORE_BUILD_ID: options.buildId,
        ...(options.activationRequestPath === undefined
          ? {}
          : { LEARNING_MORE_ACTIVATION_REQUEST: options.activationRequestPath }),
        ...(options.activationStatusPath === undefined
          ? {}
          : { LEARNING_MORE_ACTIVATION_STATUS: options.activationStatusPath }),
      },
      shell: false,
      windowsHide: true,
      stdio: 'ignore',
    }),
  );
}

export async function waitForLauncherReady(
  expectedBuildId?: string,
  timeoutMs = 20_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const [control, readiness] = await Promise.all([
        fetch('http://127.0.0.1:43119/control/v1/status', {
          headers: { accept: 'application/json', origin: 'http://127.0.0.1:43119' },
          signal: AbortSignal.timeout(1_000),
        }),
        fetch('http://127.0.0.1:43119/api/v1/runtime/ready', {
          headers: { accept: 'application/json' },
          signal: AbortSignal.timeout(1_000),
        }),
      ]);
      if (control.ok && readiness.ok) {
        const status = (await control.json()) as Record<string, unknown>;
        const ready = (await readiness.json()) as Record<string, unknown>;
        if (
          status.state === 'healthy' &&
          ready.status === 'ready' &&
          (expectedBuildId === undefined || ready.buildId === expectedBuildId)
        ) {
          return;
        }
      }
    } catch {
      // Launcher and Server can both be unavailable during a verified replacement.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('launcher_ready_timeout');
}
