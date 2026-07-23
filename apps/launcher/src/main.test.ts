import { describe, expect, it, vi } from 'vitest';

import {
  createLauncherRuntime,
  projectWorkspaceActivation,
  type LauncherDependencies,
} from './main.js';

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
      return { mode: 'reconnect' as const };
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
  it('projects durable activation failure after Launcher replacement', () => {
    expect(
      projectWorkspaceActivation(
        { state: 'healthy', crashCount: 0 },
        {
          schemaVersion: 2,
          requestId: 'request-01',
          phase: 'failed',
          sourceBuildId: 'build_new',
          activeBuildId: 'build_old',
          targetBuildId: 'build_new',
          attempt: 2,
          errorCode: 'candidate_build_failed',
          errorStage: 'building',
          startedAt: '2026-07-16T00:00:00.000Z',
          updatedAt: '2026-07-16T00:02:00.000Z',
          completedAt: '2026-07-16T00:02:00.000Z',
        },
        'build_old',
      ),
    ).toMatchObject({
      state: 'activation_failed',
      targetBuildId: 'build_new',
      activation: { errorCode: 'candidate_build_failed' },
    });
  });

  it('starts in the fixed recovery order and reports healthy only after verified readiness', async () => {
    const adapters = dependencies();
    const launcher = createLauncherRuntime(adapters);
    await launcher.start();
    expect(adapters.calls).toEqual(['lease', 'observe', 'recover', 'start', 'ready']);
    expect(adapters.calls).not.toContain('open');
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
    expect(adapters.calls).toEqual(['lease']);
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

  it('delegates a changed workspace to Host activation instead of restarting the old server', async () => {
    const activation = {
      schemaVersion: 2 as const,
      requestId: 'request-01',
      phase: 'building' as const,
      sourceBuildId: 'build_new',
      activeBuildId: 'build_old',
      targetBuildId: 'build_new',
      attempt: 1 as const,
      startedAt: '2026-07-16T00:00:00.000Z',
      updatedAt: '2026-07-16T00:00:01.000Z',
    };
    const requestWorkspaceActivation = vi.fn().mockResolvedValue({
      mode: 'activate' as const,
      targetBuildId: 'build_new',
      activation,
    });
    const adapters = dependencies({ requestWorkspaceActivation });
    const launcher = createLauncherRuntime(adapters);
    await launcher.start();
    adapters.calls.length = 0;

    await launcher.reconnect();

    expect(requestWorkspaceActivation).toHaveBeenCalledTimes(1);
    expect(adapters.calls).toEqual([]);
    expect(launcher.status()).toEqual({
      state: 'rebuilding',
      crashCount: 0,
      targetBuildId: 'build_new',
      activation,
    });
  });

  it('uses Host activation for frontend synchronization without restarting Server', async () => {
    const activation = {
      schemaVersion: 2 as const,
      requestId: 'request-02',
      phase: 'building' as const,
      sourceBuildId: 'build_new',
      targetBuildId: 'build_new',
      attempt: 1 as const,
      startedAt: '2026-07-16T00:00:00.000Z',
      updatedAt: '2026-07-16T00:00:01.000Z',
    };
    const adapters = dependencies({
      syncFrontend: vi.fn().mockResolvedValue({
        mode: 'activate' as const,
        targetBuildId: 'build_new',
        activation,
      }),
    });
    const launcher = createLauncherRuntime(adapters);
    await launcher.start();
    adapters.calls.length = 0;

    await expect(launcher.syncFrontend()).resolves.toMatchObject({
      state: 'rebuilding',
      targetBuildId: 'build_new',
    });
    expect(adapters.calls).toEqual([]);
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
    expect(adapters.calls).not.toContain('open');

    await expect(launcher.reconnect()).resolves.toEqual({ state: 'healthy', crashCount: 0 });
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
