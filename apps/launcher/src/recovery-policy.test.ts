import { describe, expect, it, vi } from 'vitest';

import {
  createConfigRestartDebouncer,
  decideStartupRecovery,
  nextCrashRecovery,
} from './recovery-policy.js';

const healthy = {
  configValid: true,
  storeState: 'ready' as const,
  manifestState: 'valid' as const,
  processState: 'verified_owned' as const,
  portState: 'owned_by_manifest' as const,
  healthState: 'identity_verified' as const,
};

describe('Launcher recovery policy', () => {
  it('starts without a manifest, reuses a verified healthy process, and quarantines stale metadata', () => {
    expect(
      decideStartupRecovery({
        ...healthy,
        manifestState: 'missing',
        processState: 'missing',
        portState: 'free',
        healthState: 'unreachable',
      }),
    ).toEqual({ action: 'start_new', state: 'starting' });
    expect(decideStartupRecovery(healthy)).toEqual({ action: 'reuse', state: 'healthy' });
    expect(
      decideStartupRecovery({
        ...healthy,
        manifestState: 'stale',
        processState: 'missing',
        portState: 'free',
        healthState: 'unreachable',
      }),
    ).toEqual({ action: 'quarantine_and_start', state: 'starting' });
  });

  it('never terminates a foreign port owner or wrong-identity process', () => {
    expect(
      decideStartupRecovery({
        ...healthy,
        portState: 'foreign_owner',
        processState: 'foreign_or_reused_pid',
        healthState: 'identity_mismatch',
      }),
    ).toEqual({ action: 'manual', state: 'blocked_external_port' });
    expect(
      decideStartupRecovery({
        ...healthy,
        portState: 'owned_by_manifest',
        processState: 'foreign_or_reused_pid',
        healthState: 'identity_mismatch',
      }),
    ).toEqual({ action: 'manual', state: 'blocked_identity_mismatch' });
  });

  it.each([
    [{ ...healthy, configValid: false }, 'blocked_invalid_config'],
    [{ ...healthy, storeState: 'corrupted' as const }, 'blocked_store_corrupted'],
    [{ ...healthy, storeState: 'migration_failed' as const }, 'blocked_migration_failed'],
  ])('blocks non-restartable failures', (input, expected) => {
    expect(decideStartupRecovery(input)).toEqual({ action: 'manual', state: expected });
  });

  it('uses bounded exponential backoff and blocks the sixth crash in ten minutes', () => {
    const now = Date.parse('2026-07-13T00:10:00.000Z');
    expect(nextCrashRecovery([], now)).toEqual({ state: 'backoff', delayMs: 500 });
    expect(nextCrashRecovery([now - 1_000, now - 2_000], now)).toEqual({
      state: 'backoff',
      delayMs: 2_000,
    });
    expect(
      nextCrashRecovery([now - 1_000, now - 2_000, now - 3_000, now - 4_000, now - 5_000], now),
    ).toEqual({ state: 'blocked_restart_storm' });
  });

  it('coalesces one configuration batch into one restart after 750ms', async () => {
    vi.useFakeTimers();
    const restart = vi.fn().mockResolvedValue(undefined);
    const debouncer = createConfigRestartDebouncer(restart);
    debouncer.changed();
    debouncer.changed();
    debouncer.changed();
    await vi.advanceTimersByTimeAsync(749);
    expect(restart).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(restart).toHaveBeenCalledTimes(1);
    debouncer.close();
    vi.useRealTimers();
  });
});
