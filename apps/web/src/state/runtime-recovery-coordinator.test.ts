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
      verifyActivated: vi.fn().mockResolvedValue(undefined),
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
      verifyActivated: vi.fn().mockResolvedValue(undefined),
      refreshRuntime: vi.fn().mockResolvedValue(undefined),
      refreshAi: vi.fn().mockResolvedValue(undefined),
    });

    expect(waitUntilReady).toHaveBeenCalledWith('build_new');
  });

  it('does not complete when the served web build remains old', async () => {
    const coordinator = createRuntimeRecoveryCoordinator();
    const refreshRuntime = vi.fn();

    await expect(
      coordinator.recover({
        verify: vi.fn().mockResolvedValue(undefined),
        reconnect: vi.fn().mockResolvedValue({ targetBuildId: 'build_new' }),
        waitUntilReady: vi.fn().mockResolvedValue({ ...readiness, buildId: 'build_new' }),
        verifyActivated: vi.fn().mockRejectedValue(new Error('served_web_build_mismatch')),
        refreshRuntime,
        refreshAi: vi.fn(),
      }),
    ).rejects.toThrow('served_web_build_mismatch');

    expect(refreshRuntime).not.toHaveBeenCalled();
    expect(coordinator.snapshot()).toMatchObject({
      kind: 'failed',
      reason: 'served_web_build_mismatch',
    });
  });

  it('separates AI refresh failure from recovered local service health', async () => {
    const coordinator = createRuntimeRecoveryCoordinator();

    await coordinator.recover({
      verify: vi.fn().mockResolvedValue(undefined),
      reconnect: vi.fn().mockResolvedValue({}),
      waitUntilReady: vi.fn().mockResolvedValue(readiness),
      verifyActivated: vi.fn().mockResolvedValue(undefined),
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
        verifyActivated: vi.fn(),
        refreshRuntime: vi.fn(),
        refreshAi: vi.fn(),
      }),
    ).rejects.toThrow('runtime_ready_timeout');
    expect(coordinator.snapshot()).toMatchObject({
      kind: 'failed',
      reason: 'runtime_ready_timeout',
    });
  });

  it('preserves public activation failure details for the runtime center', async () => {
    const coordinator = createRuntimeRecoveryCoordinator();
    const activation = {
      schemaVersion: 2 as const,
      requestId: 'request-01',
      phase: 'failed' as const,
      sourceBuildId: 'build-new',
      activeBuildId: 'build-old',
      targetBuildId: 'build-new',
      attempt: 2 as const,
      errorCode: 'candidate_build_failed' as const,
      errorStage: 'building',
      startedAt: '2026-07-16T00:00:00.000Z',
      updatedAt: '2026-07-16T00:02:00.000Z',
      completedAt: '2026-07-16T00:02:00.000Z',
    };
    const failure = Object.assign(new Error('candidate_build_failed'), {
      activation,
      oldRuntimeAvailable: true,
    });

    await expect(
      coordinator.recover({
        verify: vi.fn().mockResolvedValue(undefined),
        reconnect: vi.fn().mockResolvedValue({ targetBuildId: 'build-new' }),
        waitUntilReady: vi.fn().mockRejectedValue(failure),
        verifyActivated: vi.fn(),
        refreshRuntime: vi.fn(),
        refreshAi: vi.fn(),
      }),
    ).rejects.toThrow('candidate_build_failed');

    expect(coordinator.snapshot()).toMatchObject({
      kind: 'failed',
      reason: 'candidate_build_failed',
      activation: { attempt: 2, activeBuildId: 'build-old' },
      oldRuntimeAvailable: true,
    });
    coordinator.reconcileReadiness({ ...readiness, buildId: 'build-old' });
    expect(coordinator.snapshot()).toMatchObject({
      kind: 'failed',
      reason: 'candidate_build_failed',
    });
  });

  it('clears a stale recovery failure when a later authoritative readiness probe is healthy', async () => {
    const coordinator = createRuntimeRecoveryCoordinator();

    await expect(
      coordinator.recover({
        verify: vi.fn().mockResolvedValue(undefined),
        reconnect: vi.fn().mockResolvedValue({}),
        waitUntilReady: vi.fn().mockRejectedValue(new Error('runtime_ready_timeout')),
        verifyActivated: vi.fn(),
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

  it('accepts operational readiness while a background projection remains degraded', async () => {
    const coordinator = createRuntimeRecoveryCoordinator();

    await expect(
      coordinator.recover({
        verify: vi.fn().mockResolvedValue(undefined),
        reconnect: vi.fn().mockResolvedValue({}),
        waitUntilReady: vi.fn().mockRejectedValue(new Error('runtime_ready_timeout')),
        verifyActivated: vi.fn(),
        refreshRuntime: vi.fn(),
        refreshAi: vi.fn(),
      }),
    ).rejects.toThrow('runtime_ready_timeout');

    const backgroundDegraded = {
      ...readiness,
      projectionStatus: 'degraded' as const,
      reasonCode: 'background_projection_recovery_failed',
    };
    coordinator.reconcileReadiness(backgroundDegraded);

    expect(coordinator.snapshot()).toMatchObject({
      kind: 'completed',
      readiness: backgroundDegraded,
      aiRecoveryFailed: false,
    });
  });
});
