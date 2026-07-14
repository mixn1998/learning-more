import { describe, expect, it, vi } from 'vitest';

import type { ActivationRepository, ActivationState } from './activation-repository.js';
import { createHostSupervisor, type ManagedLauncherProcess } from './supervisor.js';

class ScriptedProcess implements ManagedLauncherProcess {
  readonly pid: number;
  private resolveExit!: (
    value: Readonly<{ exitCode: number | null; signal: string | null }>,
  ) => void;
  readonly waitForExit: Promise<Readonly<{ exitCode: number | null; signal: string | null }>>;

  constructor(pid: number) {
    this.pid = pid;
    this.waitForExit = new Promise((resolve) => {
      this.resolveExit = resolve;
    });
  }

  exit(exitCode = 1) {
    this.resolveExit({ exitCode, signal: null });
  }

  async stop() {
    this.resolveExit({ exitCode: 0, signal: 'SIGTERM' });
  }
}

function activationFixture(): ActivationRepository {
  let state: ActivationState = {
    schemaVersion: 1,
    phase: 'stable',
    activeBuildId: 'build-a',
    updatedAt: '2026-07-14T00:00:00.000Z',
  };
  return {
    async current() {
      return state;
    },
    releaseRoot(buildId) {
      return `D:\\releases\\${buildId}`;
    },
    async prepare(candidateBuildId) {
      state = { ...state, phase: 'prepared', candidateBuildId };
      return state;
    },
    async commit(candidateBuildId) {
      state = {
        schemaVersion: 1,
        phase: 'stable',
        activeBuildId: candidateBuildId,
        previousBuildId: state.activeBuildId,
        updatedAt: '2026-07-14T00:00:01.000Z',
      };
      return state;
    },
    async rollback() {
      state = {
        schemaVersion: 1,
        phase: 'stable',
        activeBuildId: state.activeBuildId,
        updatedAt: '2026-07-14T00:00:02.000Z',
      };
      return state;
    },
    async recover() {
      return this.rollback();
    },
  };
}

describe('Host Supervisor', () => {
  it('restarts an unexpectedly exited Launcher with bounded backoff', async () => {
    const first = new ScriptedProcess(43119);
    const second = new ScriptedProcess(43120);
    const startLauncher = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
    const wait = vi.fn().mockResolvedValue(undefined);
    const supervisor = createHostSupervisor({
      activation: activationFixture(),
      startLauncher,
      verifyCandidate: vi.fn().mockResolvedValue(undefined),
      verifyReady: vi.fn().mockResolvedValue(undefined),
      wait,
      now: vi.fn().mockReturnValue(1_000),
    });

    const running = supervisor.run('D:\\workspace\\Learning MORE');
    await vi.waitFor(() => expect(startLauncher).toHaveBeenCalledTimes(1));
    first.exit();
    await vi.waitFor(() => expect(startLauncher).toHaveBeenCalledTimes(2));
    expect(wait).toHaveBeenCalledWith(500);
    await supervisor.stop();
    await running;
  });

  it('rolls back a candidate that cannot become ready', async () => {
    const current = new ScriptedProcess(43120);
    const candidate = new ScriptedProcess(43121);
    const previous = new ScriptedProcess(43122);
    const activation = activationFixture();
    const startLauncher = vi
      .fn()
      .mockReturnValueOnce(current)
      .mockReturnValueOnce(candidate)
      .mockReturnValueOnce(previous);
    const restoreBackup = vi.fn().mockResolvedValue(undefined);
    const supervisor = createHostSupervisor({
      activation,
      startLauncher,
      verifyCandidate: vi.fn().mockResolvedValue(undefined),
      verifyReady: vi
        .fn()
        .mockRejectedValueOnce(new Error('candidate_not_ready'))
        .mockResolvedValueOnce(undefined),
      restoreBackup,
      wait: vi.fn().mockResolvedValue(undefined),
      now: Date.now,
    });

    const running = supervisor.run('D:\\workspace\\Learning MORE');
    await vi.waitFor(() => expect(startLauncher).toHaveBeenCalledTimes(1));
    await expect(supervisor.activateCandidate('build-b')).resolves.toMatchObject({
      state: 'rolled-back',
      activeBuildId: 'build-a',
      failedCandidateBuildId: 'build-b',
    });
    expect(restoreBackup).toHaveBeenCalledTimes(1);
    expect(startLauncher).toHaveBeenLastCalledWith('D:\\workspace\\Learning MORE');
    await expect(activation.current()).resolves.toMatchObject({ activeBuildId: 'build-a' });
    await supervisor.stop();
    await running;
  });
});
