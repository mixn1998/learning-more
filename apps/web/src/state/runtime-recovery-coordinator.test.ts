import { describe, expect, it, vi } from 'vitest';

import { createRuntimeRecoveryCoordinator } from './runtime-recovery-coordinator.js';

const readiness = {
  status: 'ready',
  instanceId: 'instance_recovered',
  buildId: 'development',
  protocolVersion: '1',
  storeStatus: 'ready',
  projectionStatus: 'ready',
  providerStatus: 'ready',
} as const;

describe('RuntimeRecoveryCoordinator', () => {
  it('stays recovering through transient probe failures and becomes ready after verification', async () => {
    let releaseReconnect!: (value: Readonly<{ targetBuildId: string }>) => void;
    const reconnectGate = new Promise<Readonly<{ targetBuildId: string }>>((resolve) => {
      releaseReconnect = resolve;
    });
    const snapshots: Array<{ readonly kind: string }> = [];
    const coordinator = createRuntimeRecoveryCoordinator();
    coordinator.subscribe((snapshot) => snapshots.push(snapshot));

    const recovery = coordinator.recover({
      verify: vi.fn().mockResolvedValue(undefined),
      reconnect: vi.fn(() => reconnectGate),
      waitUntilReady: vi.fn().mockResolvedValue(readiness),
      refreshRuntime: vi.fn().mockResolvedValue(undefined),
      refreshAi: vi.fn().mockResolvedValue(undefined),
    });

    await vi.waitFor(() => expect(coordinator.snapshot()).toMatchObject({ kind: 'recovering' }));
    for (let index = 0; index < 7; index += 1) {
      expect(coordinator.shouldTreatProbeFailureAsOffline()).toBe(false);
    }
    releaseReconnect({ targetBuildId: 'development' });
    await recovery;

    expect(snapshots.some((snapshot) => snapshot.kind === 'offline')).toBe(false);
    expect(coordinator.snapshot()).toMatchObject({ kind: 'completed', aiRecoveryFailed: false });
  });

  it('waits for the build selected by a workspace activation instead of accepting the old ready instance', async () => {
    const coordinator = createRuntimeRecoveryCoordinator();
    const waitUntilReady = vi.fn().mockResolvedValue({ ...readiness, buildId: 'build_new' });

    await coordinator.recover({
      verify: vi.fn().mockResolvedValue(undefined),
      reconnect: vi.fn().mockResolvedValue({ targetBuildId: 'build_new' }),
      waitUntilReady,
      refreshRuntime: vi.fn().mockResolvedValue(undefined),
      refreshAi: vi.fn().mockResolvedValue(undefined),
    });

    expect(waitUntilReady).toHaveBeenCalledWith('build_new');
  });

  it('separates AI refresh failure from recovered local service health', async () => {
    const coordinator = createRuntimeRecoveryCoordinator();

    await coordinator.recover({
      verify: vi.fn().mockResolvedValue(undefined),
      reconnect: vi.fn().mockResolvedValue({}),
      waitUntilReady: vi.fn().mockResolvedValue(readiness),
      refreshRuntime: vi.fn().mockResolvedValue(undefined),
      refreshAi: vi.fn().mockRejectedValue(new Error('ai unavailable')),
    });

    expect(coordinator.snapshot()).toMatchObject({
      kind: 'completed',
      aiRecoveryFailed: true,
    });
  });

  it('publishes a stable failure only when local recovery fails', async () => {
    const coordinator = createRuntimeRecoveryCoordinator();

    await expect(
      coordinator.recover({
        verify: vi.fn().mockResolvedValue(undefined),
        reconnect: vi.fn().mockResolvedValue({}),
        waitUntilReady: vi.fn().mockRejectedValue(new Error('runtime_ready_timeout')),
        refreshRuntime: vi.fn(),
        refreshAi: vi.fn(),
      }),
    ).rejects.toThrow('runtime_ready_timeout');
    expect(coordinator.snapshot()).toMatchObject({
      kind: 'failed',
      reason: 'runtime_ready_timeout',
    });
  });

  it('clears a stale recovery failure when a later authoritative readiness probe is healthy', async () => {
    const coordinator = createRuntimeRecoveryCoordinator();

    await expect(
      coordinator.recover({
        verify: vi.fn().mockResolvedValue(undefined),
        reconnect: vi.fn().mockResolvedValue({}),
        waitUntilReady: vi.fn().mockRejectedValue(new Error('runtime_ready_timeout')),
        refreshRuntime: vi.fn(),
        refreshAi: vi.fn(),
      }),
    ).rejects.toThrow('runtime_ready_timeout');

    coordinator.reconcileReadiness(readiness);

    expect(coordinator.snapshot()).toMatchObject({
      kind: 'completed',
      readiness,
      aiRecoveryFailed: false,
    });
  });
});
