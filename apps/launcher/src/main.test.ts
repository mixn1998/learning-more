import { describe, expect, it, vi } from 'vitest';

import { createLauncherRuntime, type LauncherDependencies } from './main.js';

function dependencies(
  overrides: Partial<LauncherDependencies> = {},
): LauncherDependencies & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    acquireLease: async () => {
      calls.push('lease');
    },
    observeStartup: async () => {
      calls.push('observe');
      return {
        configValid: true,
        storeState: 'ready',
        manifestState: 'missing',
        processState: 'missing',
        portState: 'free',
        healthState: 'unreachable',
      };
    },
    quarantineManifest: async () => {
      calls.push('quarantine');
    },
    recoverStore: async () => {
      calls.push('recover');
    },
    startServer: async () => {
      calls.push('start');
    },
    waitForVerifiedReady: async () => {
      calls.push('ready');
    },
    openApplication: async () => {
      calls.push('open');
    },
    drainServer: async () => {
      calls.push('drain');
      return true;
    },
    terminateVerifiedServer: async () => {
      calls.push('terminate');
      return true;
    },
    syncFrontend: async () => {
      calls.push('sync');
    },
    createDiagnostics: async () => ({ artifactRef: 'diagnostics_01' }),
    wait: async (delayMs) => {
      calls.push(`wait:${delayMs}`);
    },
    now: () => Date.parse('2026-07-13T00:00:00.000Z'),
    ...overrides,
  };
}

describe('Launcher runtime orchestration', () => {
  it('starts in the fixed recovery order and reports healthy only after verified readiness', async () => {
    const adapters = dependencies();
    const launcher = createLauncherRuntime(adapters);
    await launcher.start();
    expect(adapters.calls).toEqual(['lease', 'observe', 'recover', 'start', 'ready', 'open']);
    expect(launcher.status()).toEqual({ state: 'healthy', crashCount: 0 });
  });

  it('blocks on a foreign port without starting or terminating anything', async () => {
    const adapters = dependencies({
      observeStartup: async () => ({
        configValid: true,
        storeState: 'ready',
        manifestState: 'missing',
        processState: 'foreign_or_reused_pid',
        portState: 'foreign_owner',
        healthState: 'identity_mismatch',
      }),
    });
    const launcher = createLauncherRuntime(adapters);
    await launcher.start();
    expect(launcher.status().state).toBe('blocked_external_port');
    expect(adapters.calls).toEqual(['lease', 'open']);
  });

  it('uses graceful draining and only asks the verified terminator after timeout', async () => {
    const adapters = dependencies({ drainServer: vi.fn().mockResolvedValue(false) });
    const launcher = createLauncherRuntime(adapters);
    await launcher.start();
    adapters.calls.length = 0;
    await launcher.reconnect();
    expect(adapters.calls).toEqual(['terminate', 'start', 'ready']);
    expect(launcher.status().state).toBe('healthy');
  });

  it('keeps the launcher available in degraded state when the internal server cannot start', async () => {
    const waitForVerifiedReady = vi
      .fn()
      .mockRejectedValueOnce(new Error('server_ready_timeout'))
      .mockResolvedValueOnce(undefined);
    const adapters = dependencies({ waitForVerifiedReady });
    const launcher = createLauncherRuntime(adapters);

    await expect(launcher.start()).resolves.toBeUndefined();
    expect(launcher.status()).toEqual({ state: 'degraded', crashCount: 0 });
    expect(adapters.calls).toContain('open');

    await expect(launcher.reconnect()).resolves.toBeUndefined();
    expect(launcher.status()).toEqual({ state: 'healthy', crashCount: 0 });
  });

  it('returns to degraded without an unhandled rejection when crash recovery fails', async () => {
    const adapters = dependencies({
      waitForVerifiedReady: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('server_ready_timeout')),
    });
    const launcher = createLauncherRuntime(adapters);
    await launcher.start();

    await expect(launcher.serverExitedUnexpectedly()).resolves.toBeUndefined();
    expect(launcher.status().state).toBe('degraded');
  });

  it('applies bounded crash backoff and blocks the sixth crash in ten minutes', async () => {
    let now = Date.parse('2026-07-13T00:00:00.000Z');
    const adapters = dependencies({ now: () => now });
    const launcher = createLauncherRuntime(adapters);
    await launcher.start();
    adapters.calls.length = 0;
    for (let index = 0; index < 5; index += 1) {
      await launcher.serverExitedUnexpectedly();
      now += 1_000;
    }
    expect(adapters.calls.filter((call) => call.startsWith('wait:'))).toEqual([
      'wait:500',
      'wait:1000',
      'wait:2000',
      'wait:4000',
      'wait:8000',
    ]);
    await launcher.serverExitedUnexpectedly();
    expect(launcher.status().state).toBe('blocked_restart_storm');
  });
});
