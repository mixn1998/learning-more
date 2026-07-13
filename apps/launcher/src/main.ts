import { watch } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { buildControlServer } from './control-server.js';
import { createLocalRuntimeAdapters } from './local-runtime.js';
import type { LauncherState, StartupObservation } from './recovery-policy.js';
import {
  createConfigRestartDebouncer,
  decideStartupRecovery,
  nextCrashRecovery,
} from './recovery-policy.js';

export interface LauncherDependencies {
  acquireLease(): Promise<void>;
  observeStartup(): Promise<StartupObservation>;
  quarantineManifest(): Promise<void>;
  recoverStore(): Promise<void>;
  startServer(): Promise<void>;
  waitForVerifiedReady(): Promise<void>;
  openApplication(): Promise<void>;
  drainServer(timeoutMs: number): Promise<boolean>;
  terminateVerifiedServer(): Promise<boolean>;
  syncFrontend(): Promise<void>;
  createDiagnostics(): Promise<Readonly<{ artifactRef: string }>>;
  wait(delayMs: number): Promise<void>;
  now(): number;
}

export interface LauncherRuntime {
  start(): Promise<void>;
  reconnect(): Promise<void>;
  syncFrontend(): Promise<void>;
  diagnose(): Promise<Readonly<{ artifactRef: string }>>;
  serverExitedUnexpectedly(): Promise<void>;
  status(): Readonly<{ state: LauncherState; crashCount: number }>;
}

export function createLauncherRuntime(dependencies: LauncherDependencies): LauncherRuntime {
  let state: LauncherState = 'stopped';
  const crashTimestamps: number[] = [];

  async function startNewServer(): Promise<void> {
    await dependencies.recoverStore();
    await dependencies.startServer();
    await dependencies.waitForVerifiedReady();
    state = 'healthy';
  }

  return {
    async start() {
      state = 'starting';
      await dependencies.acquireLease();
      const decision = decideStartupRecovery(await dependencies.observeStartup());
      state = decision.state;
      if (decision.action === 'manual') return;
      if (decision.action === 'reuse') {
        await dependencies.openApplication();
        return;
      }
      if (decision.action === 'quarantine_and_start') {
        await dependencies.quarantineManifest();
      }
      if (decision.action === 'restart_verified') {
        const terminated = await dependencies.terminateVerifiedServer();
        if (!terminated) {
          state = 'blocked_identity_mismatch';
          return;
        }
      }
      await startNewServer();
      await dependencies.openApplication();
    },
    async reconnect() {
      state = 'restarting';
      const drained = await dependencies.drainServer(10_000);
      if (!drained && !(await dependencies.terminateVerifiedServer())) {
        state = 'blocked_identity_mismatch';
        return;
      }
      await dependencies.startServer();
      await dependencies.waitForVerifiedReady();
      state = 'healthy';
    },
    async syncFrontend() {
      await dependencies.syncFrontend();
    },
    diagnose() {
      return dependencies.createDiagnostics();
    },
    async serverExitedUnexpectedly() {
      const now = dependencies.now();
      const recovery = nextCrashRecovery(crashTimestamps, now);
      if (recovery.state === 'blocked_restart_storm') {
        state = recovery.state;
        return;
      }
      crashTimestamps.push(now);
      state = recovery.state;
      await dependencies.wait(recovery.delayMs);
      state = 'restarting';
      await dependencies.startServer();
      await dependencies.waitForVerifiedReady();
      state = 'healthy';
    },
    status() {
      return { state, crashCount: crashTimestamps.length };
    },
  };
}

export async function runLauncher(): Promise<Readonly<{ close(): Promise<void> }>> {
  const projectRoot = path.resolve(process.env.LEARNING_MORE_PROJECT_ROOT ?? process.cwd());
  const runtimeDirectory = path.resolve(
    process.env.LEARNING_MORE_RUNTIME_DIR ?? path.join(projectRoot, '.learning-more-runtime'),
  );
  const runtimeReference: { current?: LauncherRuntime } = {};
  const adapters = await createLocalRuntimeAdapters({
    projectRoot,
    runtimeDirectory,
    dataRoot: path.resolve(
      process.env.LEARNING_MORE_DATA_ROOT ?? path.join(projectRoot, '.learning-more-data'),
    ),
    serverEntry: path.resolve(
      process.env.LEARNING_MORE_SERVER_ENTRY ??
        path.join(projectRoot, 'apps', 'server', 'dist', 'bootstrap', 'main.js'),
    ),
    serverPort: 43_120,
    webUrl: process.env.LEARNING_MORE_WEB_URL ?? 'http://127.0.0.1:5173',
    allowedOrigin: process.env.LEARNING_MORE_ALLOWED_ORIGIN ?? 'http://127.0.0.1:5173',
    openBrowser: process.env.LEARNING_MORE_NO_OPEN !== '1',
    onUnexpectedExit: () => {
      void runtimeReference.current?.serverExitedUnexpectedly();
    },
  });
  const activeRuntime = createLauncherRuntime(adapters.dependencies);
  runtimeReference.current = activeRuntime;
  const control = await buildControlServer({
    allowedOrigin: process.env.LEARNING_MORE_ALLOWED_ORIGIN ?? 'http://127.0.0.1:5173',
    capability: adapters.capability,
    getStatus: async () => activeRuntime.status(),
    reconnect: async () => {
      await activeRuntime.reconnect();
      return activeRuntime.status();
    },
    syncFrontend: async () => {
      await activeRuntime.syncFrontend();
      return activeRuntime.status();
    },
    diagnose: () => activeRuntime.diagnose(),
  });
  await control.listen();
  try {
    await activeRuntime.start();
  } catch (error) {
    await control.close();
    await adapters.close();
    throw error;
  }
  const configRestart = createConfigRestartDebouncer(() => activeRuntime.reconnect());
  const configWatcher = watch(projectRoot, { persistent: false }, (_event, filename) => {
    if (filename?.toString().toLowerCase() === 'runtime.json') configRestart.changed();
  });
  return {
    async close() {
      configWatcher.close();
      configRestart.close();
      await control.close();
      await adapters.close();
    },
  };
}

const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href) {
  const launcher = await runLauncher();
  const stop = async () => {
    await launcher.close();
    process.exit(0);
  };
  process.once('SIGINT', () => void stop());
  process.once('SIGTERM', () => void stop());
}
