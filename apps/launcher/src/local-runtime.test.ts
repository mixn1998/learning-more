import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const spawnProcess = vi.hoisted(() =>
  vi.fn(() => ({
    unref: vi.fn(),
  })),
);

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: spawnProcess };
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
});
