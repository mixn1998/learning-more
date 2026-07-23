import { EventEmitter } from 'node:events';
import process from 'node:process';

import { describe, expect, it, vi } from 'vitest';

import {
  adoptVerifiedServerProcess,
  startServerProcess,
  terminateVerifiedChild,
} from './server-process.js';

class FakeChild extends EventEmitter {
  readonly pid = 41_320;
  readonly kill = vi.fn(() => true);
}

describe('Launcher server process', () => {
  it('spawns with an argument array, no shell, and a hidden production window', () => {
    const child = new FakeChild();
    const spawn = vi.fn(() => child);
    const managed = startServerProcess(
      {
        executable: 'C:\\runtime\\node.exe',
        arguments: ['server.js', '--server-port', '43120'],
        cwd: 'C:\\Learning MORE',
        environment: { SAFE_VALUE: 'yes' },
      },
      spawn,
    );
    expect(managed.pid).toBe(41_320);
    expect(spawn).toHaveBeenCalledWith(
      'C:\\runtime\\node.exe',
      ['server.js', '--server-port', '43120'],
      expect.objectContaining({
        cwd: 'C:\\Learning MORE',
        env: { SAFE_VALUE: 'yes' },
        shell: false,
        windowsHide: true,
      }),
    );
  });

  it('refuses to terminate until the live child passes the complete identity verifier', async () => {
    const child = new FakeChild();
    const manifest = { pid: child.pid, instanceId: 'instance_01', generation: 1 };
    const observed = { pid: child.pid, identityFingerprint: 'observed' };
    const observe = vi.fn().mockResolvedValue(observed);
    const reject = vi.fn(() => ({ healthy: false, mismatches: ['buildId'] }));
    expect(
      await terminateVerifiedChild({
        child,
        manifest,
        observeIdentity: observe,
        verifyIdentity: reject,
      }),
    ).toEqual({ terminated: false, reason: 'identity_mismatch' });
    expect(child.kill).not.toHaveBeenCalled();

    const accept = vi.fn(() => ({ healthy: true, mismatches: [] }));
    child.kill.mockImplementation(() => {
      queueMicrotask(() => child.emit('exit', 0, null));
      return true;
    });
    const terminating = terminateVerifiedChild({
      child,
      manifest,
      observeIdentity: observe,
      verifyIdentity: accept,
    });
    await expect(terminating).resolves.toEqual({ terminated: true });
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(accept).toHaveBeenCalledWith(manifest, observed);
  });

  it('can safely stop a real child smoke process after verification', async () => {
    const managed = startServerProcess({
      executable: process.execPath,
      arguments: ['-e', 'setInterval(() => {}, 1000)'],
      cwd: process.cwd(),
      environment: process.env,
    });
    const manifest = { pid: managed.pid, instanceId: 'smoke', generation: 1 };
    try {
      await expect(
        terminateVerifiedChild({
          child: managed,
          manifest,
          observeIdentity: async () => ({ pid: managed.pid, identityFingerprint: 'smoke' }),
          verifyIdentity: () => ({ healthy: true, mismatches: [] }),
        }),
      ).resolves.toEqual({ terminated: true });
    } finally {
      managed.kill();
    }
  });

  it('can adopt and safely stop a previously verified server process', async () => {
    const spawned = startServerProcess({
      executable: process.execPath,
      arguments: ['-e', 'setInterval(() => {}, 1000)'],
      cwd: process.cwd(),
      environment: process.env,
    });
    const adopted = adoptVerifiedServerProcess(spawned.pid);
    try {
      await expect(
        terminateVerifiedChild({
          child: adopted,
          manifest: { pid: adopted.pid },
          observeIdentity: async () => ({ pid: adopted.pid }),
          verifyIdentity: () => ({ healthy: true, mismatches: [] }),
          timeoutMs: 2_000,
        }),
      ).resolves.toEqual({ terminated: true });
    } finally {
      spawned.kill();
    }
  });
});
