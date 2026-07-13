import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';

export type RuntimeHarness = Readonly<{
  root: string;
  runtimeDirectory: string;
  dataRoot: string;
  launcher: ChildProcess;
}>;

export type StandaloneServer = Readonly<{
  process: ChildProcess;
  runtimeDirectory: string;
}>;

export async function waitFor<T>(operation: () => Promise<T | undefined>, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await operation().catch(() => undefined);
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('runtime_e2e_timeout');
}

export async function controlStatus(): Promise<Record<string, unknown> | undefined> {
  const response = await fetch('http://127.0.0.1:43119/control/v1/status', {
    headers: { origin: 'http://127.0.0.1:5173' },
  }).catch(() => undefined);
  if (response?.ok !== true) return undefined;
  return (await response.json()) as Record<string, unknown>;
}

export async function startLauncher(root: string): Promise<RuntimeHarness> {
  const runtimeDirectory = path.join(root, 'runtime');
  const dataRoot = path.join(root, 'data');
  await mkdir(root, { recursive: true });
  const projectRoot = process.cwd();
  const launcher = spawn(
    process.execPath,
    ['--import', 'tsx', 'tools/test-processes/launcher-driver.ts'],
    {
      cwd: projectRoot,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        LEARNING_MORE_PROJECT_ROOT: projectRoot,
        LEARNING_MORE_RUNTIME_DIR: runtimeDirectory,
        LEARNING_MORE_DATA_ROOT: dataRoot,
        LEARNING_MORE_LOG_DIR: path.join(root, 'logs'),
        LEARNING_MORE_DIAGNOSTICS_DIR: path.join(root, 'diagnostics'),
        LEARNING_MORE_SECRET_DIR: path.join(root, 'secrets'),
        LEARNING_MORE_SERVER_ENTRY: path.join(
          projectRoot,
          'apps',
          'server',
          'dist',
          'bootstrap',
          'main.js',
        ),
        LEARNING_MORE_NO_OPEN: '1',
      },
    },
  );
  await waitFor(async () => {
    const status = await controlStatus();
    return status === undefined ? undefined : true;
  });
  return { root, runtimeDirectory, dataRoot, launcher };
}

export async function startStandaloneServer(root: string): Promise<StandaloneServer> {
  const projectRoot = process.cwd();
  const runtimeDirectory = path.join(root, 'runtime');
  await mkdir(root, { recursive: true });
  const server = spawn(
    process.execPath,
    [
      path.join(projectRoot, 'apps', 'server', 'dist', 'bootstrap', 'main.js'),
      '--data-root',
      path.join(root, 'data'),
      '--server-port',
      '43120',
    ],
    {
      cwd: projectRoot,
      windowsHide: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        LEARNING_MORE_RUNTIME_DIR: runtimeDirectory,
        LEARNING_MORE_LOG_DIR: path.join(root, 'logs'),
        LEARNING_MORE_DIAGNOSTICS_DIR: path.join(root, 'diagnostics'),
        LEARNING_MORE_SECRET_DIR: path.join(root, 'secrets'),
      },
    },
  );
  await waitFor(async () => {
    const response = await fetch('http://127.0.0.1:43120/api/v1/runtime/ready').catch(
      () => undefined,
    );
    const manifest = await readFile(path.join(runtimeDirectory, 'runtime-manifest.json'), 'utf8')
      .then((content) => JSON.parse(content) as { pid?: unknown })
      .catch(() => undefined);
    return response?.ok === true && manifest?.pid === server.pid ? true : undefined;
  });
  return { process: server, runtimeDirectory };
}

export async function stopStandaloneServer(server: StandaloneServer): Promise<void> {
  if (server.process.exitCode !== null) return;
  const exited = once(server.process, 'exit');
  server.process.kill();
  await exited;
}

export async function stopLauncher(harness: RuntimeHarness): Promise<void> {
  if (harness.launcher.exitCode !== null) return;
  const exited = once(harness.launcher, 'exit');
  harness.launcher.stdin?.write('close\n');
  await Promise.race([
    exited,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('launcher_close_timeout')), 15_000),
    ),
  ]);
}

export async function crashLauncher(harness: RuntimeHarness): Promise<void> {
  if (harness.launcher.exitCode !== null) return;
  const exited = once(harness.launcher, 'exit');
  harness.launcher.stdin?.write('crash\n');
  await exited;
}

export async function runtimeManifest(harness: RuntimeHarness) {
  return JSON.parse(
    await readFile(path.join(harness.runtimeDirectory, 'runtime-manifest.json'), 'utf8'),
  ) as { pid: number; generation: number; dataRootHash: string };
}

export async function removeRuntimeRoot(root: string): Promise<void> {
  const resolved = path.resolve(root);
  const expectedParent = path.resolve(process.cwd(), 'tests', '.tmp');
  if (!resolved.startsWith(`${expectedParent}${path.sep}`))
    throw new Error('unsafe_runtime_cleanup');
  await rm(resolved, { recursive: true, force: true });
}
