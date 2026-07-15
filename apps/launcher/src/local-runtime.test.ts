import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const spawnProcess = vi.hoisted(() =>
  vi.fn(() => ({
    unref: vi.fn(),
  })),
);
const execFileProcess = vi.hoisted(() =>
  vi.fn((...arguments_: unknown[]) => {
    const callback = arguments_.at(-1) as (
      error: Error | null,
      stdout: string,
      stderr: string,
    ) => void;
    callback(null, '', '');
  }),
);

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, execFile: execFileProcess, spawn: spawnProcess };
});

import {
  createLocalRuntimeAdapters,
  type LocalRuntimeAdapters,
  type LocalRuntimeOptions,
} from './local-runtime.js';

const roots: string[] = [];
const adapters: LocalRuntimeAdapters[] = [];

afterEach(async () => {
  for (const adapter of adapters.splice(0)) await adapter.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
  spawnProcess.mockClear();
  execFileProcess.mockClear();
});

describe('local Launcher runtime', () => {
  it('keeps frontend synchronization browser-free even when a legacy open flag is supplied', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'learning-more-launcher-'));
    roots.push(root);
    const options = {
      projectRoot: root,
      runtimeDirectory: root,
      dataRoot: path.join(root, 'data'),
      serverEntry: path.join(root, 'server.js'),
      serverPort: 43_120,
      webUrl: 'http://127.0.0.1:43119',
      allowedOrigin: 'http://127.0.0.1:43119',
      openBrowser: true,
    } as LocalRuntimeOptions & { openBrowser: boolean };
    const adapter = await createLocalRuntimeAdapters(options);
    adapters.push(adapter);

    await adapter.dependencies.syncFrontend();

    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it('uses the same durable workspace activation path for frontend synchronization', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'learning-more-launcher-'));
    roots.push(root);
    const requestPath = path.join(root, 'activation-request.json');
    const statusPath = path.join(root, 'activation-status.json');
    const adapter = await createLocalRuntimeAdapters({
      projectRoot: root,
      runtimeDirectory: root,
      dataRoot: path.join(root, 'data'),
      serverEntry: path.join(root, 'server.js'),
      serverPort: 43_120,
      webUrl: 'http://127.0.0.1:43119',
      allowedOrigin: 'http://127.0.0.1:43119',
      activationRequestPath: requestPath,
      activationStatusPath: statusPath,
    });
    adapters.push(adapter);

    const pending = adapter.dependencies.syncFrontend();
    await vi.waitFor(async () => {
      expect(JSON.parse(await readFile(requestPath, 'utf8'))).toMatchObject({ schemaVersion: 1 });
    });
    const request = JSON.parse(await readFile(requestPath, 'utf8')) as { requestId: string };
    await writeFile(
      statusPath,
      `${JSON.stringify({
        schemaVersion: 2,
        requestId: request.requestId,
        phase: 'building',
        sourceBuildId: 'build-new',
        activeBuildId: 'build-old',
        targetBuildId: 'build-new',
        attempt: 1,
        startedAt: '2026-07-16T00:00:00.000Z',
        updatedAt: '2026-07-16T00:00:01.000Z',
      })}\n`,
      'utf8',
    );

    await expect(pending).resolves.toMatchObject({ mode: 'activate', targetBuildId: 'build-new' });
    await expect(adapter.readActivationStatus()).resolves.toMatchObject({ phase: 'building' });
  });

  it('runs only the Host-provided repair entry when acknowledgement is unavailable', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'learning-more-launcher-'));
    roots.push(root);
    const hostEntry = path.join(root, 'apps', 'host', 'dist', 'main.js');
    const adapter = await createLocalRuntimeAdapters({
      projectRoot: root,
      runtimeDirectory: root,
      dataRoot: path.join(root, 'data'),
      serverEntry: path.join(root, 'server.js'),
      serverPort: 43_120,
      webUrl: 'http://127.0.0.1:43119',
      allowedOrigin: 'http://127.0.0.1:43119',
      activationRequestPath: path.join(root, 'activation-request.json'),
      activationStatusPath: path.join(root, 'activation-status.json'),
      hostEntry,
      hostProjectRoot: root,
      activationAcknowledgementMs: 1,
      activationTimeoutMs: 5,
    });
    adapters.push(adapter);

    await expect(adapter.dependencies.requestWorkspaceActivation?.()).rejects.toMatchObject({
      code: 'host_unavailable',
    });
    expect(execFileProcess).toHaveBeenCalledWith(
      process.execPath,
      [hostEntry, 'repair', '--project-root', root],
      expect.objectContaining({ cwd: root, windowsHide: true }),
      expect.any(Function),
    );
  });
});
