import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const executeFile = promisify(execFile);

const driver = `
import { pathToFileURL } from 'node:url';
const launcherEntry = process.argv[2];
const { runLauncher } = await import(pathToFileURL(launcherEntry).href);
const waitFor = async (operation) => {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const value = await operation().catch(() => undefined);
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('portable_smoke_timeout');
};
const launcher = await runLauncher();
try {
  const ui = await waitFor(async () => {
    const response = await fetch('http://127.0.0.1:43119/');
    return response.ok ? response.text() : undefined;
  });
  const proxied = await waitFor(async () => {
    const response = await fetch('http://127.0.0.1:43119/api/v1/runtime/ready');
    return response.ok ? response.json() : undefined;
  });
  const direct = await waitFor(async () => {
    const response = await fetch('http://127.0.0.1:43120/api/v1/runtime/ready');
    return response.ok ? response.json() : undefined;
  });
  if (!ui.includes('<div id="root">')) throw new Error('portable_ui_invalid');
  if (proxied.instanceId !== direct.instanceId) throw new Error('portable_proxy_identity_mismatch');
  process.stdout.write(JSON.stringify({ status: 'verified', instanceId: direct.instanceId }) + '\\n');
} finally {
  await launcher.close();
}
`;

export type PortableSmokeResult = Readonly<{
  status: 'verified';
  instanceId: string;
  storeVerification: unknown;
}>;

export async function smokePortableRelease(
  portableRoot: string,
  smokeRoot = path.join(path.dirname(portableRoot), 'portable-smoke-state'),
): Promise<PortableSmokeResult> {
  const resolvedPortable = path.resolve(portableRoot);
  const resolvedSmoke = path.resolve(smokeRoot);
  await rm(resolvedSmoke, { recursive: true, force: true });
  await mkdir(resolvedSmoke, { recursive: true });
  const driverPath = path.join(resolvedSmoke, 'portable-driver.mjs');
  await writeFile(driverPath, driver, 'utf8');
  const releaseManifest = JSON.parse(
    await readFile(path.join(resolvedPortable, 'release-manifest.json'), 'utf8'),
  ) as { buildId: string };
  const runtime = path.join(resolvedPortable, 'runtime', 'node.exe');
  const launcherEntry = path.join(resolvedPortable, 'app', 'launcher', 'dist', 'main.js');
  const dataRoot = path.join(resolvedSmoke, 'data');
  const environment = {
    ...process.env,
    LOCALAPPDATA: resolvedSmoke,
    LEARNING_MORE_PROJECT_ROOT: resolvedPortable,
    LEARNING_MORE_DATA_ROOT: dataRoot,
    LEARNING_MORE_RUNTIME_DIR: path.join(resolvedSmoke, 'runtime'),
    LEARNING_MORE_LOG_DIR: path.join(resolvedSmoke, 'logs'),
    LEARNING_MORE_SECRET_DIR: path.join(resolvedSmoke, 'secrets'),
    LEARNING_MORE_SERVER_ENTRY: path.join(resolvedPortable, 'app', 'server', 'main.js'),
    LEARNING_MORE_WEB_ROOT: path.join(resolvedPortable, 'app', 'web'),
    LEARNING_MORE_WEB_URL: 'http://127.0.0.1:43119',
    LEARNING_MORE_ALLOWED_ORIGIN: 'http://127.0.0.1:43119',
    LEARNING_MORE_BUILD_ID: releaseManifest.buildId,
    LEARNING_MORE_NO_OPEN: '1',
  };
  const launched = await executeFile(runtime, [driverPath, launcherEntry], {
    cwd: resolvedPortable,
    env: environment,
    encoding: 'utf8',
    timeout: 30_000,
    windowsHide: true,
  });
  const runtimeResult = JSON.parse(launched.stdout.trim()) as {
    status: 'verified';
    instanceId: string;
  };
  const verified = await executeFile(
    runtime,
    [path.join(resolvedPortable, 'tools', 'cli', 'dist', 'main.js'), 'verify', dataRoot, '--json'],
    {
      cwd: resolvedPortable,
      env: environment,
      encoding: 'utf8',
      timeout: 15_000,
      windowsHide: true,
    },
  );
  return {
    ...runtimeResult,
    storeVerification: JSON.parse(verified.stdout.trim()) as unknown,
  };
}

const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href) {
  const portableRoot = process.argv[2];
  if (portableRoot === undefined) throw new Error('portable_root_required');
  process.stdout.write(`${JSON.stringify(await smokePortableRelease(portableRoot))}\n`);
}
