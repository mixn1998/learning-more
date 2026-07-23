import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const spawnProcess = vi.hoisted(() =>
  vi.fn(() => ({
    pid: 43_119,
    exitCode: null,
    signalCode: null,
    once: vi.fn(),
    kill: vi.fn(),
  })),
);

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: spawnProcess };
});

import {
  commandMatchesLauncher,
  startOrAdoptLauncher,
  waitForLauncherReady,
} from './launcher-process.js';

const roots: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  spawnProcess.mockClear();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('commandMatchesLauncher', () => {
  it('accepts the direct Launcher entry and the verified workspace wrapper', () => {
    const launcherEntry = 'D:\\workspace\\Learning MORE\\apps\\launcher\\dist\\main.js';
    const wrapperEntry = 'tools\\start-learning-more.mjs';

    expect(
      commandMatchesLauncher(
        '"C:\\Program Files\\nodejs\\node.exe" "D:\\workspace\\Learning MORE\\apps\\launcher\\dist\\main.js"',
        [launcherEntry, wrapperEntry],
      ),
    ).toBe(true);
    expect(
      commandMatchesLauncher(
        '"C:\\Program Files\\nodejs\\node.exe" tools/start-learning-more.mjs',
        [launcherEntry, wrapperEntry],
      ),
    ).toBe(true);
  });

  it('rejects an unrelated Node process', () => {
    expect(
      commandMatchesLauncher('node unrelated-script.mjs', [
        'D:\\workspace\\Learning MORE\\apps\\launcher\\dist\\main.js',
      ]),
    ).toBe(false);
  });

  it('uses the local origin while verifying a candidate Launcher', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ state: 'healthy' }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 'ready', buildId: 'build-new' }), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetch);

    await expect(waitForLauncherReady('build-new', 100)).resolves.toBeUndefined();

    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      headers: { accept: 'application/json', origin: 'http://127.0.0.1:43119' },
    });
  });

  it('accepts a target-matching candidate while Host still reports activation in progress', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              state: 'rebuilding',
              targetBuildId: 'build-new',
              activation: { phase: 'activating' },
            }),
            { status: 200 },
          ),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ status: 'ready', buildId: 'build-new' }), { status: 200 }),
        ),
    );

    await expect(waitForLauncherReady('build-new', 100)).resolves.toBeUndefined();
  });

  it('does not report an adopted Launcher exit from a transient observation failure', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'learning-more-adopted-launcher-'));
    roots.push(root);
    await writeFile(
      path.join(root, 'launcher.lock'),
      JSON.stringify({ pid: 43_119, startedAt: '2026-07-15T00:00:00.000Z' }),
      'utf8',
    );
    const observeProcess = vi
      .fn()
      .mockResolvedValueOnce({
        state: 'running',
        executablePath: process.execPath,
        commandLine: 'node tools\\start-learning-more.mjs',
      })
      .mockResolvedValueOnce({ state: 'unavailable' })
      .mockResolvedValueOnce({ state: 'missing' });

    const launcher = await startOrAdoptLauncher({
      projectRoot: root,
      runtimeDirectory: root,
      dataRoot: path.join(root, 'data'),
      secretDirectory: path.join(root, 'secrets'),
      launcherEntry: path.join(root, 'apps', 'launcher', 'dist', 'main.js'),
      serverEntry: path.join(root, 'apps', 'server', 'dist', 'bootstrap', 'main.js'),
      webRoot: path.join(root, 'apps', 'web', 'dist'),
      buildId: 'test-build',
      acceptedCommandMarkers: ['tools\\start-learning-more.mjs'],
      observeProcess,
    });

    await expect(launcher.waitForExit).resolves.toEqual({ exitCode: null, signal: null });
    expect(observeProcess).toHaveBeenCalledTimes(3);
  });

  it('keeps rollback-compatible Launcher releases headless', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'learning-more-spawned-launcher-'));
    roots.push(root);

    await startOrAdoptLauncher({
      projectRoot: root,
      runtimeDirectory: root,
      dataRoot: path.join(root, 'data'),
      secretDirectory: path.join(root, 'secrets'),
      launcherEntry: path.join(root, 'app', 'launcher', 'dist', 'main.js'),
      hostEntry: path.join(root, 'app', 'host', 'dist', 'main.js'),
      hostProjectRoot: root,
      serverEntry: path.join(root, 'app', 'server', 'main.js'),
      webRoot: path.join(root, 'app', 'web'),
      buildId: 'test-build',
      observeProcess: vi.fn(),
    });

    expect(spawnProcess).toHaveBeenCalledWith(
      process.execPath,
      [path.join(root, 'app', 'launcher', 'dist', 'main.js')],
      expect.objectContaining({
        env: expect.objectContaining({
          LEARNING_MORE_NO_OPEN: '1',
          LEARNING_MORE_HOST_ENTRY: path.join(root, 'app', 'host', 'dist', 'main.js'),
          LEARNING_MORE_HOST_PROJECT_ROOT: root,
        }),
      }),
    );
  });
});
