import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { access, mkdir, open, readFile, rename, rm, type FileHandle } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';

import type { LauncherDependencies } from './main.js';
import {
  observeExistingRuntime,
  parseRuntimeManifest,
  type PublicReadiness,
  type RuntimeManifest,
} from './runtime-observer.js';
import {
  adoptVerifiedServerProcess,
  startServerProcess,
  terminateVerifiedChild,
  type ManagedChildProcess,
} from './server-process.js';
import { requestWorkspaceActivation } from './workspace-activation.js';

export type LocalRuntimeOptions = Readonly<{
  projectRoot: string;
  runtimeDirectory: string;
  dataRoot: string;
  serverEntry: string;
  serverPort: number;
  webUrl: string;
  allowedOrigin: string;
  openBrowser: boolean;
  activationRequestPath?: string;
  activationStatusPath?: string;
  onUnexpectedExit?(): void;
}>;

export type LocalRuntimeAdapters = Readonly<{
  dependencies: LauncherDependencies;
  capability: Readonly<{ value: string; expiresAt: number }>;
  refreshCapability(): Readonly<{ value: string; expiresAt: number }>;
  close(): Promise<void>;
}>;

function executeFile(executable: string, arguments_: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      [...arguments_],
      { encoding: 'utf8', shell: false, windowsHide: true },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
  });
}

function encodedPowerShellArguments(script: string): readonly string[] {
  return [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-EncodedCommand',
    Buffer.from(script, 'utf16le').toString('base64'),
  ];
}

async function canBind(port: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') resolve(false);
      else reject(error);
    });
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
  });
}

async function observePortOwnerPid(port: number): Promise<number | undefined> {
  if (await canBind(port)) return undefined;
  if (process.platform !== 'win32') return 0;
  const netstat = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'netstat.exe');
  let output: string;
  try {
    output = await executeFile(netstat, ['-ano', '-p', 'tcp']);
  } catch {
    return 0;
  }
  for (const line of output.split(/\r?\n/)) {
    const columns = line.trim().split(/\s+/);
    if (
      columns.length >= 5 &&
      columns[0]?.toUpperCase() === 'TCP' &&
      columns[1] === `127.0.0.1:${port}` &&
      columns[3]?.toUpperCase() === 'LISTENING'
    ) {
      const pid = Number(columns[4]);
      return Number.isInteger(pid) && pid > 0 ? pid : 0;
    }
  }
  return 0;
}

async function observeExecutable(pid: number): Promise<string | undefined> {
  if (process.platform !== 'win32' || pid < 1) return undefined;
  const powershell = path.join(
    process.env.SystemRoot ?? 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  const script =
    '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); ' +
    `$observed = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; ` +
    'if ($null -ne $observed) { [Console]::Out.Write($observed.Path) }';
  let output: string;
  try {
    output = (await executeFile(powershell, encodedPowerShellArguments(script))).trim();
  } catch {
    return undefined;
  }
  return output === '' ? undefined : output;
}

async function fetchReadiness(url: string): Promise<PublicReadiness | undefined> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
    if (!response.ok) return undefined;
    const value = (await response.json()) as Record<string, unknown>;
    if (
      typeof value.status !== 'string' ||
      typeof value.instanceId !== 'string' ||
      typeof value.buildId !== 'string' ||
      typeof value.protocolVersion !== 'string'
    ) {
      return undefined;
    }
    return {
      status: value.status,
      instanceId: value.instanceId,
      buildId: value.buildId,
      protocolVersion: value.protocolVersion,
      ...(typeof value.generation === 'number' ? { generation: value.generation } : {}),
      ...(typeof value.startedAt === 'string' ? { startedAt: value.startedAt } : {}),
      ...(typeof value.identityFingerprint === 'string'
        ? { identityFingerprint: value.identityFingerprint }
        : {}),
    };
  } catch {
    return undefined;
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export async function createLocalRuntimeAdapters(
  options: LocalRuntimeOptions,
): Promise<LocalRuntimeAdapters> {
  await mkdir(options.runtimeDirectory, { recursive: true });
  const manifestPath = path.join(options.runtimeDirectory, 'runtime-manifest.json');
  const leasePath = path.join(options.runtimeDirectory, 'launcher.lock');
  let lease: FileHandle | undefined;
  let child: ManagedChildProcess | undefined;
  let manifest: RuntimeManifest | undefined;
  let expectedExit = false;
  const capability = {
    value: randomBytes(32).toString('base64url'),
    expiresAt: Date.now() + 5 * 60_000,
  };

  async function readManifest(): Promise<RuntimeManifest | undefined> {
    try {
      return parseRuntimeManifest(JSON.parse(await readFile(manifestPath, 'utf8')) as unknown);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async function observe() {
    manifest = await readManifest();
    const portOwnerPid = await observePortOwnerPid(options.serverPort);
    const processExecutable =
      portOwnerPid === undefined ? undefined : await observeExecutable(portOwnerPid);
    const readiness = manifest === undefined ? undefined : await fetchReadiness(manifest.healthUrl);
    const observation = observeExistingRuntime({
      ...(manifest === undefined ? {} : { manifest }),
      ...(portOwnerPid === undefined ? {} : { portOwnerPid }),
      ...(processExecutable === undefined ? {} : { processExecutable }),
      ...(readiness === undefined ? {} : { readiness }),
    });
    if (
      observation.healthState === 'identity_verified' &&
      child === undefined &&
      manifest !== undefined
    ) {
      child = adoptVerifiedServerProcess(manifest.pid);
      child.once('exit', () => {
        child = undefined;
        if (!expectedExit) options.onUnexpectedExit?.();
      });
    }
    return observation;
  }

  const dependencies: LauncherDependencies = {
    async acquireLease() {
      try {
        lease = await open(leasePath, 'wx');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        const existing = JSON.parse(await readFile(leasePath, 'utf8')) as { pid?: unknown };
        if (typeof existing.pid === 'number' && processIsAlive(existing.pid)) {
          throw new Error('launcher_already_running');
        }
        await rename(leasePath, `${leasePath}.stale.${Date.now()}`);
        lease = await open(leasePath, 'wx');
      }
      await lease.writeFile(
        JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
      );
    },
    observeStartup: observe,
    async quarantineManifest() {
      await rename(manifestPath, `${manifestPath}.stale.${Date.now()}`);
      manifest = undefined;
    },
    async recoverStore() {
      await access(options.dataRoot).catch(async (error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
        await mkdir(options.dataRoot, { recursive: true });
      });
    },
    async startServer() {
      await access(options.serverEntry);
      expectedExit = false;
      child = startServerProcess({
        executable: process.execPath,
        arguments: [
          options.serverEntry,
          '--data-root',
          options.dataRoot,
          '--server-port',
          String(options.serverPort),
        ],
        cwd: options.projectRoot,
        environment: {
          ...process.env,
          LEARNING_MORE_RUNTIME_DIR: options.runtimeDirectory,
          LEARNING_MORE_ALLOWED_ORIGIN: options.allowedOrigin,
        },
      });
      child.once('exit', () => {
        child = undefined;
        if (!expectedExit) options.onUnexpectedExit?.();
      });
    },
    async waitForVerifiedReady() {
      const deadline = Date.now() + 15_000;
      let lastObservation: Awaited<ReturnType<typeof observe>> | undefined;
      while (Date.now() < deadline) {
        try {
          const observation = await observe();
          lastObservation = observation;
          if (observation.healthState === 'identity_verified') {
            if (child === undefined || manifest?.pid === child.pid) return;
          }
        } catch {
          // Manifest replacement can briefly race this poll.
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error(
        `server_ready_timeout:${JSON.stringify({
          observation: lastObservation,
          childPid: child?.pid,
          manifestPid: manifest?.pid,
        })}`,
      );
    },
    async openApplication() {
      if (!options.openBrowser) return;
      spawn('rundll32.exe', ['url.dll,FileProtocolHandler', options.webUrl], {
        shell: false,
        windowsHide: true,
        detached: true,
        stdio: 'ignore',
      }).unref();
    },
    async drainServer() {
      return false;
    },
    async terminateVerifiedServer() {
      const activeChild = child;
      const activeManifest = await readManifest();
      if (activeChild === undefined || activeManifest === undefined) return false;
      expectedExit = true;
      const result = await terminateVerifiedChild({
        child: activeChild,
        manifest: activeManifest,
        observeIdentity: observe,
        verifyIdentity: (_expected, observed) => ({
          healthy: observed.healthState === 'identity_verified',
          mismatches: observed.healthState === 'identity_verified' ? [] : ['identity'],
        }),
      });
      if (!result.terminated) expectedExit = false;
      return result.terminated;
    },
    async requestWorkspaceActivation() {
      if (
        options.activationRequestPath === undefined ||
        options.activationStatusPath === undefined
      ) {
        return { mode: 'reconnect' } as const;
      }
      return requestWorkspaceActivation({
        requestPath: options.activationRequestPath,
        statusPath: options.activationStatusPath,
      });
    },
    async syncFrontend() {
      if (options.openBrowser) {
        spawn('rundll32.exe', ['url.dll,FileProtocolHandler', options.webUrl], {
          shell: false,
          windowsHide: true,
          detached: true,
          stdio: 'ignore',
        }).unref();
      }
    },
    async createDiagnostics() {
      const response = await fetch(
        `http://127.0.0.1:${options.serverPort}/api/v1/runtime/diagnostics`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-csrf-token': process.env.LEARNING_MORE_CSRF_TOKEN ?? 'development-csrf',
          },
          body: '{}',
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (!response.ok) throw new Error('diagnostics_unavailable');
      const result = (await response.json()) as { artifactRef?: unknown };
      if (typeof result.artifactRef !== 'string' || result.artifactRef === '') {
        throw new Error('diagnostics_invalid');
      }
      return { artifactRef: result.artifactRef };
    },
    async wait(delayMs) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    },
    now: Date.now,
  };

  return {
    dependencies,
    capability,
    refreshCapability() {
      if (Date.now() >= capability.expiresAt - 30_000) {
        capability.value = randomBytes(32).toString('base64url');
        capability.expiresAt = Date.now() + 5 * 60_000;
      }
      return capability;
    },
    async close() {
      if (child !== undefined) await dependencies.terminateVerifiedServer();
      if (lease !== undefined) {
        await lease.close();
        lease = undefined;
        try {
          const owner = JSON.parse(await readFile(leasePath, 'utf8')) as { pid?: unknown };
          if (owner.pid === process.pid) await rm(leasePath, { force: true });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }
    },
  };
}
