import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { desiredHostTask, executeHostCommand, readReleaseIdentity } from './main.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe('Host CLI', () => {
  it('wraps Host in one persistent non-Node scheduled-task runner', () => {
    const entryPath = 'D:\\Learning MORE\\apps\\host\\dist\\main.js';
    const projectRoot = 'D:\\Learning MORE';

    const task = desiredHostTask({ entryPath, projectRoot, userId: 'DOGGY\\14627' });

    expect(task.executable).toBe('C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    expect(task.arguments).toEqual(
      expect.arrayContaining([
        '-NoProfile',
        '-NonInteractive',
        '-WindowStyle',
        'Hidden',
        '-EncodedCommand',
      ]),
    );
    const encoded = task.arguments[task.arguments.indexOf('-EncodedCommand') + 1]!;
    const script = Buffer.from(encoded, 'base64').toString('utf16le');
    expect(script).toContain('while ($true)');
    expect(script).toContain(
      "& $config.node $config.entry 'run' '--project-root' $config.projectRoot",
    );
    expect(script).toContain('Start-Sleep -Seconds 2');
    expect(script).not.toContain('Start-Process');
    expect(task.trigger).toBe('logon');
  });

  it('dispatches only the named management operation', async () => {
    const manager = {
      install: vi.fn().mockResolvedValue({ state: 'installed', matches: true }),
      status: vi.fn().mockResolvedValue({ state: 'installed', matches: true }),
      repair: vi.fn().mockResolvedValue({ state: 'installed', matches: true }),
      uninstall: vi.fn().mockResolvedValue(undefined),
    };
    const output = vi.fn();

    await executeHostCommand(['status'], {
      manager,
      runHost: vi.fn(),
      output,
    });

    expect(manager.status).toHaveBeenCalledTimes(1);
    expect(manager.install).not.toHaveBeenCalled();
    expect(output).toHaveBeenCalledWith(expect.stringContaining('"matches":true'));
  });

  it('rejects unknown commands without invoking the Host', async () => {
    const runHost = vi.fn();

    await expect(
      executeHostCommand(['launch-anything'], {
        manager: {
          install: vi.fn(),
          status: vi.fn(),
          repair: vi.fn(),
          uninstall: vi.fn(),
        },
        runHost,
        output: vi.fn(),
      }),
    ).rejects.toThrow('host_command_invalid');
    expect(runHost).not.toHaveBeenCalled();
  });

  it('loads the integrated workspace build identity without treating it as portable', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'learning-more-host-identity-'));
    roots.push(root);
    await writeFile(
      path.join(root, '.learning-more-build.json'),
      `${JSON.stringify({
        schemaVersion: 1,
        buildId: 'f464201eddda-wb10e0400b890',
        sourceRevision: 'f464201eddda4fa9a06d23c47249abb3885e1c9f',
        sourceFingerprint: 'b'.repeat(64),
      })}\n`,
      'utf8',
    );

    await expect(readReleaseIdentity(root)).resolves.toEqual({
      portable: false,
      buildId: 'f464201eddda-wb10e0400b890',
    });
  });
});
