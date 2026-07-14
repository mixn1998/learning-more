import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createActivationRepository } from './activation-repository.js';
import { createHostSupervisor, type ManagedLauncherProcess } from './supervisor.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

async function availablePort(): Promise<number> {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('test_port_unavailable');
  const port = address.port;
  server.close();
  await once(server, 'close');
  return port;
}

function spawnRelease(releaseRoot: string, port: number): ManagedLauncherProcess {
  const buildId = path.basename(releaseRoot);
  const child = spawn(process.execPath, [path.join(releaseRoot, 'server.mjs')], {
    cwd: releaseRoot,
    env: { ...process.env, BUILD_ID: buildId, PORT: String(port) },
    shell: false,
    windowsHide: true,
    stdio: 'ignore',
  });
  if (child.pid === undefined) throw new Error('fixture_spawn_failed');
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
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      await waitForExit;
    },
  };
}

async function waitForBuild(port: number, buildId: string, timeoutMs = 1_500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/ready`, {
        signal: AbortSignal.timeout(200),
      });
      const payload = (await response.json()) as { buildId?: unknown; status?: unknown };
      if (response.ok && payload.buildId === buildId && payload.status === 'ready') return;
    } catch {
      // Candidate replacement has a bounded unavailable window.
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`fixture_not_ready:${buildId}`);
}

describe('Host Supervisor process rollback drill', () => {
  it('stops a real unhealthy candidate process and restores the previous build identity', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'learning-more-host-rollback-'));
    roots.push(root);
    const releasesRoot = path.join(root, 'releases');
    const buildA = path.join(releasesRoot, 'build-a');
    const buildB = path.join(releasesRoot, 'build-b');
    await Promise.all([mkdir(buildA, { recursive: true }), mkdir(buildB, { recursive: true })]);
    const fixture = `
import http from 'node:http';
const buildId = process.env.BUILD_ID;
const healthy = buildId === 'build-a';
const server = http.createServer((_request, response) => {
  response.writeHead(healthy ? 200 : 503, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ buildId, status: healthy ? 'ready' : 'degraded' }));
});
server.listen(Number(process.env.PORT), '127.0.0.1');
const stop = () => server.close(() => process.exit(0));
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
`;
    await Promise.all([
      writeFile(path.join(buildA, 'server.mjs'), fixture, 'utf8'),
      writeFile(path.join(buildB, 'server.mjs'), fixture, 'utf8'),
    ]);
    const activation = createActivationRepository({
      statePath: path.join(root, 'host-state.json'),
      releasesRoot,
      initialActiveBuildId: 'build-a',
    });
    const port = await availablePort();
    const supervisor = createHostSupervisor({
      activation,
      startLauncher: (releaseRoot) => spawnRelease(releaseRoot, port),
      verifyCandidate: async () => undefined,
      verifyReady: (releaseRoot) => waitForBuild(port, path.basename(releaseRoot), 500),
      wait: async (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
      now: Date.now,
    });

    const running = supervisor.run(buildA);
    await waitForBuild(port, 'build-a');
    await expect(supervisor.activateCandidate('build-b')).resolves.toEqual({
      state: 'rolled-back',
      activeBuildId: 'build-a',
      failedCandidateBuildId: 'build-b',
    });
    await expect(
      fetch(`http://127.0.0.1:${port}/ready`).then((response) => response.json()),
    ).resolves.toMatchObject({
      buildId: 'build-a',
      status: 'ready',
    });
    await expect(activation.current()).resolves.toMatchObject({
      phase: 'stable',
      activeBuildId: 'build-a',
    });

    await supervisor.stop();
    await running;
  });
});
