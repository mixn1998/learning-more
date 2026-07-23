import type { ActivationRepository } from './activation-repository.js';

export interface ManagedLauncherProcess {
  readonly pid: number;
  readonly waitForExit: Promise<Readonly<{ exitCode: number | null; signal: string | null }>>;
  stop(): Promise<void>;
}

export type HostSupervisorStatus = Readonly<{
  state: 'stopped' | 'starting' | 'healthy' | 'backoff' | 'replacing' | 'blocked_restart_storm';
  launcherPid?: number;
  crashCount: number;
  releaseRoot?: string;
}>;

export interface HostSupervisor {
  run(initialReleaseRoot: string): Promise<void>;
  stop(): Promise<void>;
  activateCandidate(candidateBuildId: string): Promise<
    | Readonly<{ state: 'activated'; activeBuildId: string }>
    | Readonly<{
        state: 'rolled-back';
        activeBuildId: string;
        failedCandidateBuildId: string;
      }>
  >;
  status(): HostSupervisorStatus;
}

export function createHostSupervisor(options: {
  activation: ActivationRepository;
  startLauncher(releaseRoot: string): ManagedLauncherProcess | Promise<ManagedLauncherProcess>;
  verifyCandidate(releaseRoot: string): Promise<void>;
  verifyReady(releaseRoot: string): Promise<void>;
  restoreBackup?(): Promise<void>;
  wait(delayMs: number): Promise<void>;
  now(): number;
}): HostSupervisor {
  let state: HostSupervisorStatus['state'] = 'stopped';
  let current: ManagedLauncherProcess | undefined;
  let currentRoot: string | undefined;
  let stopping = false;
  let replacing = false;
  const crashTimestamps: number[] = [];
  const replacementWaiters = new Set<() => void>();

  const signalReplacementFinished = () => {
    for (const resolve of replacementWaiters) resolve();
    replacementWaiters.clear();
  };

  const waitForReplacement = () =>
    new Promise<void>((resolve) => {
      replacementWaiters.add(resolve);
    });

  const start = async (releaseRoot: string) => {
    state = 'starting';
    currentRoot = releaseRoot;
    current = await options.startLauncher(releaseRoot);
    state = 'healthy';
    return current;
  };

  return {
    async run(initialReleaseRoot) {
      stopping = false;
      currentRoot = initialReleaseRoot;
      while (!stopping) {
        const observed = current ?? (await start(currentRoot));
        await observed.waitForExit;
        if (current === observed) current = undefined;
        if (stopping) break;
        if (replacing) {
          await waitForReplacement();
          continue;
        }

        const now = options.now();
        const recent = crashTimestamps.filter((timestamp) => timestamp >= now - 10 * 60_000);
        crashTimestamps.splice(0, crashTimestamps.length, ...recent, now);
        if (crashTimestamps.length >= 6) {
          state = 'blocked_restart_storm';
          break;
        }
        const delays = [500, 1_000, 2_000, 4_000, 8_000] as const;
        state = 'backoff';
        await options.wait(delays[Math.min(crashTimestamps.length - 1, delays.length - 1)]!);
      }
      if (state !== 'blocked_restart_storm') state = 'stopped';
    },
    async stop() {
      stopping = true;
      replacing = false;
      const processToStop = current;
      if (processToStop !== undefined) {
        await processToStop.stop();
        await processToStop.waitForExit;
        if (current === processToStop) current = undefined;
      }
      signalReplacementFinished();
      state = 'stopped';
    },
    async activateCandidate(candidateBuildId) {
      const before = await options.activation.current();
      const previousRoot = currentRoot ?? options.activation.releaseRoot(before.activeBuildId);
      const candidateRoot = options.activation.releaseRoot(candidateBuildId);
      await options.verifyCandidate(candidateRoot);
      await options.activation.prepare(candidateBuildId);
      replacing = true;
      state = 'replacing';
      const previousProcess = current;
      if (previousProcess !== undefined) {
        await previousProcess.stop();
        await previousProcess.waitForExit;
        if (current === previousProcess) current = undefined;
      }

      let candidate: ManagedLauncherProcess | undefined;
      try {
        candidate = await start(candidateRoot);
        await options.verifyReady(candidateRoot);
        await options.activation.commit(candidateBuildId);
        replacing = false;
        state = 'healthy';
        signalReplacementFinished();
        return { state: 'activated', activeBuildId: candidateBuildId };
      } catch {
        if (candidate !== undefined) {
          await candidate.stop();
          await candidate.waitForExit;
          if (current === candidate) current = undefined;
        }
        await options.restoreBackup?.();
        await options.activation.rollback();
        await start(previousRoot);
        await options.verifyReady(previousRoot);
        replacing = false;
        state = 'healthy';
        signalReplacementFinished();
        return {
          state: 'rolled-back',
          activeBuildId: before.activeBuildId,
          failedCandidateBuildId: candidateBuildId,
        };
      }
    },
    status() {
      return {
        state,
        ...(current === undefined ? {} : { launcherPid: current.pid }),
        crashCount: crashTimestamps.length,
        ...(currentRoot === undefined ? {} : { releaseRoot: currentRoot }),
      };
    },
  };
}
