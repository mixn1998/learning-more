import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type ActivationState = Readonly<{
  schemaVersion: 1;
  phase: 'stable' | 'prepared';
  activeBuildId: string;
  previousBuildId?: string;
  candidateBuildId?: string;
  updatedAt: string;
}>;

export interface ActivationRepository {
  current(): Promise<ActivationState>;
  releaseRoot(buildId: string): string;
  prepare(candidateBuildId: string): Promise<ActivationState>;
  commit(candidateBuildId: string): Promise<ActivationState>;
  rollback(): Promise<ActivationState>;
  recover(): Promise<ActivationState>;
}

function assertBuildId(buildId: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/u.test(buildId)) {
    throw new Error('release_build_id_invalid');
  }
}

function parseState(value: unknown): ActivationState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('activation_state_invalid');
  }
  const state = value as Record<string, unknown>;
  const allowed = new Set([
    'schemaVersion',
    'phase',
    'activeBuildId',
    'previousBuildId',
    'candidateBuildId',
    'updatedAt',
  ]);
  if (Object.keys(state).some((key) => !allowed.has(key))) {
    throw new Error('activation_state_invalid');
  }
  if (
    state.schemaVersion !== 1 ||
    (state.phase !== 'stable' && state.phase !== 'prepared') ||
    typeof state.activeBuildId !== 'string' ||
    typeof state.updatedAt !== 'string' ||
    (state.previousBuildId !== undefined && typeof state.previousBuildId !== 'string') ||
    (state.candidateBuildId !== undefined && typeof state.candidateBuildId !== 'string')
  ) {
    throw new Error('activation_state_invalid');
  }
  assertBuildId(state.activeBuildId);
  if (typeof state.previousBuildId === 'string') assertBuildId(state.previousBuildId);
  if (typeof state.candidateBuildId === 'string') assertBuildId(state.candidateBuildId);
  if (state.phase === 'prepared' && state.candidateBuildId === undefined) {
    throw new Error('activation_state_invalid');
  }
  return state as ActivationState;
}

export function createActivationRepository(options: {
  statePath: string;
  releasesRoot: string;
  initialActiveBuildId: string;
  now?: () => Date;
}): ActivationRepository {
  assertBuildId(options.initialActiveBuildId);
  const now = options.now ?? (() => new Date());

  const releaseRoot = (buildId: string) => {
    assertBuildId(buildId);
    return path.join(path.resolve(options.releasesRoot), buildId);
  };

  const replace = async (state: ActivationState): Promise<ActivationState> => {
    await mkdir(path.dirname(options.statePath), { recursive: true });
    const temporary = `${options.statePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(state)}\n`, 'utf8');
      await rename(temporary, options.statePath);
    } finally {
      await rm(temporary, { force: true });
    }
    return state;
  };

  const current = async (): Promise<ActivationState> => {
    try {
      return parseState(JSON.parse(await readFile(options.statePath, 'utf8')) as unknown);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await access(releaseRoot(options.initialActiveBuildId)).catch(() => {
        throw new Error('release_active_missing');
      });
      return replace({
        schemaVersion: 1,
        phase: 'stable',
        activeBuildId: options.initialActiveBuildId,
        updatedAt: now().toISOString(),
      });
    }
  };

  const rollback = async (): Promise<ActivationState> => {
    const state = await current();
    if (state.phase === 'stable') return state;
    return replace({
      schemaVersion: 1,
      phase: 'stable',
      activeBuildId: state.activeBuildId,
      ...(state.previousBuildId === undefined ? {} : { previousBuildId: state.previousBuildId }),
      updatedAt: now().toISOString(),
    });
  };

  return {
    current,
    releaseRoot,
    async prepare(candidateBuildId) {
      await access(releaseRoot(candidateBuildId)).catch(() => {
        throw new Error('release_candidate_missing');
      });
      const state = await current();
      return replace({
        schemaVersion: 1,
        phase: 'prepared',
        activeBuildId: state.activeBuildId,
        ...(state.previousBuildId === undefined ? {} : { previousBuildId: state.previousBuildId }),
        candidateBuildId,
        updatedAt: now().toISOString(),
      });
    },
    async commit(candidateBuildId) {
      const state = await current();
      if (state.phase !== 'prepared' || state.candidateBuildId !== candidateBuildId) {
        throw new Error('activation_commit_conflict');
      }
      return replace({
        schemaVersion: 1,
        phase: 'stable',
        activeBuildId: candidateBuildId,
        previousBuildId: state.activeBuildId,
        updatedAt: now().toISOString(),
      });
    },
    rollback,
    recover: rollback,
  };
}
