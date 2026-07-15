import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { resolveE2eEnvironment } from '../support/e2e-environment.js';

const root = process.cwd();
const temporaryRoot = path.join(root, 'tests', '.tmp');
const dataRoot = path.join(temporaryRoot, 'course-authoring-data');
const processFile = path.join(temporaryRoot, 'e2e-processes.json');

async function waitFor(url: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The direct child process is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

export default async function globalSetup() {
  const environment = resolveE2eEnvironment();
  await rm(dataRoot, { recursive: true, force: true });
  await mkdir(temporaryRoot, { recursive: true });
  const server = spawn(
    process.execPath,
    ['--import', 'tsx', 'tests/e2e/start-course-authoring-server.ts'],
    {
      cwd: root,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: {
        ...process.env,
        LEARNING_MORE_DATA_ROOT: dataRoot,
        LEARNING_MORE_E2E_SERVER_PORT: String(environment.serverPort),
        LEARNING_MORE_E2E_WEB_PORT: String(environment.webPort),
        LEARNING_MORE_E2E_BUILD_ID: environment.buildId,
      },
    },
  );
  const web = spawn(
    process.execPath,
    ['apps/web/node_modules/vite/bin/vite.js', 'apps/web', '--config', 'apps/web/vite.config.ts'],
    {
      cwd: root,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: {
        ...process.env,
        LEARNING_MORE_E2E_SERVER_PORT: String(environment.serverPort),
        LEARNING_MORE_E2E_WEB_PORT: String(environment.webPort),
        VITE_BUILD_ID: environment.buildId,
      },
    },
  );
  server.unref();
  web.unref();
  if (server.pid === undefined || web.pid === undefined)
    throw new Error('Failed to start E2E services');
  await writeFile(processFile, JSON.stringify({ server: server.pid, web: web.pid }), 'utf8');
  await Promise.all([
    waitFor(`${environment.serverBaseUrl}/api/v1/runtime/ready`),
    waitFor(environment.webBaseUrl),
  ]);
}
