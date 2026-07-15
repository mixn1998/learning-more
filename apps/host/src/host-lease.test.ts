import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { acquireHostLease } from './host-lease.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function leasePath(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'learning-more-host-lease-'));
  roots.push(root);
  return path.join(root, 'host.lock');
}

describe('Host singleton lease', () => {
  it('acquires once and only its owner can release it', async () => {
    const filePath = await leasePath();
    const lease = await acquireHostLease({
      filePath,
      executablePath: 'C:\\Program Files\\nodejs\\node.exe',
      releaseRoot: 'D:\\Learning MORE',
      pid: 43119,
      observeProcess: async () => ({
        state: 'running',
        executablePath: 'C:\\Program Files\\nodejs\\node.exe',
        commandLine: 'node host main.js D:\\Learning MORE',
      }),
    });

    await expect(
      acquireHostLease({
        filePath,
        executablePath: 'C:\\Program Files\\nodejs\\node.exe',
        releaseRoot: 'D:\\Learning MORE',
        pid: 43120,
        observeProcess: async () => ({
          state: 'running',
          executablePath: 'C:\\Program Files\\nodejs\\node.exe',
          commandLine: 'node host main.js D:\\Learning MORE',
        }),
      }),
    ).rejects.toThrow('host_already_running');

    await lease.release();
    await expect(
      acquireHostLease({
        filePath,
        executablePath: 'C:\\Program Files\\nodejs\\node.exe',
        releaseRoot: 'D:\\Learning MORE',
        pid: 43120,
        observeProcess: async () => ({ state: 'missing' }),
      }),
    ).resolves.toBeDefined();
  });

  it('quarantines a dead owner but blocks a live mismatched executable', async () => {
    const filePath = await leasePath();
    const first = await acquireHostLease({
      filePath,
      executablePath: 'C:\\Program Files\\nodejs\\node.exe',
      releaseRoot: 'D:\\Learning MORE',
      pid: 43119,
      observeProcess: async () => ({ state: 'missing' }),
    });

    await expect(
      acquireHostLease({
        filePath,
        executablePath: 'C:\\Program Files\\nodejs\\node.exe',
        releaseRoot: 'D:\\Learning MORE',
        pid: 43120,
        observeProcess: async () => ({ state: 'missing' }),
      }),
    ).resolves.toBeDefined();
    await first.release();

    await expect(
      acquireHostLease({
        filePath,
        executablePath: 'C:\\Program Files\\nodejs\\node.exe',
        releaseRoot: 'D:\\Learning MORE',
        pid: 43121,
        observeProcess: async () => ({
          state: 'running',
          executablePath: 'C:\\Windows\\System32\\cmd.exe',
          commandLine: 'cmd.exe',
        }),
      }),
    ).rejects.toThrow('host_lease_foreign_owner');
  });

  it('preserves an existing lease when process observation is temporarily unavailable', async () => {
    const filePath = await leasePath();
    const first = await acquireHostLease({
      filePath,
      executablePath: 'C:\\Program Files\\nodejs\\node.exe',
      releaseRoot: 'D:\\Learning MORE',
      pid: 43_119,
      observeProcess: async () => ({ state: 'missing' }),
    });

    const outcome = await acquireHostLease({
      filePath,
      executablePath: 'C:\\Program Files\\nodejs\\node.exe',
      releaseRoot: 'D:\\Learning MORE',
      pid: 43_120,
      observeProcess: async () => ({ state: 'unavailable' }),
    }).then(
      (lease) => ({ lease }),
      (error: unknown) => ({ error }),
    );

    if ('lease' in outcome) await outcome.lease.release();
    await first.release();
    expect('error' in outcome ? outcome.error : undefined).toEqual(
      new Error('host_process_observation_unavailable'),
    );
  });
});
