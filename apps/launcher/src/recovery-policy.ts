export type LauncherState =
  | 'stopped'
  | 'starting'
  | 'healthy'
  | 'degraded'
  | 'restarting'
  | 'rebuilding'
  | 'backoff'
  | 'blocked_external_port'
  | 'blocked_identity_mismatch'
  | 'blocked_restart_storm'
  | 'blocked_invalid_config'
  | 'blocked_store_corrupted'
  | 'blocked_migration_failed';

export type StartupObservation = Readonly<{
  configValid: boolean;
  storeState: 'ready' | 'corrupted' | 'migration_failed';
  manifestState: 'missing' | 'valid' | 'stale';
  processState: 'missing' | 'verified_owned' | 'foreign_or_reused_pid';
  portState: 'free' | 'owned_by_manifest' | 'foreign_owner';
  healthState: 'unreachable' | 'identity_verified' | 'identity_mismatch';
}>;

export type RecoveryDecision = Readonly<{
  action: 'start_new' | 'reuse' | 'quarantine_and_start' | 'restart_verified' | 'manual';
  state: LauncherState;
}>;

export function decideStartupRecovery(input: StartupObservation): RecoveryDecision {
  if (!input.configValid) return { action: 'manual', state: 'blocked_invalid_config' };
  if (input.storeState === 'corrupted') {
    return { action: 'manual', state: 'blocked_store_corrupted' };
  }
  if (input.storeState === 'migration_failed') {
    return { action: 'manual', state: 'blocked_migration_failed' };
  }
  if (input.portState === 'foreign_owner') {
    return { action: 'manual', state: 'blocked_external_port' };
  }
  if (input.processState === 'foreign_or_reused_pid' || input.healthState === 'identity_mismatch') {
    return { action: 'manual', state: 'blocked_identity_mismatch' };
  }
  if (
    input.manifestState === 'missing' &&
    input.processState === 'missing' &&
    input.portState === 'free'
  ) {
    return { action: 'start_new', state: 'starting' };
  }
  if (
    input.manifestState === 'valid' &&
    input.processState === 'verified_owned' &&
    input.portState === 'owned_by_manifest' &&
    input.healthState === 'identity_verified'
  ) {
    return { action: 'reuse', state: 'healthy' };
  }
  if (
    input.manifestState === 'stale' &&
    input.processState === 'missing' &&
    input.portState === 'free'
  ) {
    return { action: 'quarantine_and_start', state: 'starting' };
  }
  if (
    input.manifestState === 'valid' &&
    input.processState === 'verified_owned' &&
    input.portState === 'owned_by_manifest' &&
    input.healthState === 'unreachable'
  ) {
    return { action: 'restart_verified', state: 'restarting' };
  }
  return { action: 'manual', state: 'blocked_identity_mismatch' };
}

export function nextCrashRecovery(
  priorCrashTimestamps: readonly number[],
  now: number,
): Readonly<{ state: 'backoff'; delayMs: number } | { state: 'blocked_restart_storm' }> {
  const recent = priorCrashTimestamps.filter(
    (timestamp) => timestamp <= now && timestamp >= now - 10 * 60_000,
  );
  if (recent.length + 1 >= 6) return { state: 'blocked_restart_storm' };
  const delays = [500, 1_000, 2_000, 4_000, 8_000] as const;
  return { state: 'backoff', delayMs: delays[Math.min(recent.length, delays.length - 1)]! };
}

export function createConfigRestartDebouncer(
  restart: () => Promise<void>,
): Readonly<{ changed(): void; close(): void }> {
  let timer: NodeJS.Timeout | undefined;
  return {
    changed() {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        void restart().catch(() => undefined);
      }, 750);
    },
    close() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
  };
}
