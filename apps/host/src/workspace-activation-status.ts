import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type ActivationErrorCode =
  | 'source_identity_unavailable'
  | 'workspace_identity_changed'
  | 'candidate_build_failed'
  | 'candidate_stage_failed'
  | 'candidate_verification_failed'
  | 'activation_rolled_back'
  | 'host_unavailable'
  | 'host_identity_mismatch'
  | 'external_port_owner'
  | 'runtime_ready_timeout'
  | 'served_web_build_mismatch';

export type WorkspaceActivationPhase =
  | 'queued'
  | 'verifying'
  | 'building'
  | 'cleaning'
  | 'retrying'
  | 'staging'
  | 'activating'
  | 'verifying-runtime'
  | 'activated'
  | 'failed';

export type WorkspaceActivationStatus = Readonly<{
  schemaVersion: 2;
  requestId: string;
  phase: WorkspaceActivationPhase;
  sourceBuildId?: string;
  activeBuildId?: string;
  targetBuildId?: string;
  attempt: 1 | 2;
  errorCode?: ActivationErrorCode;
  errorStage?: string;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
}>;

type LegacyStatus = Readonly<{
  schemaVersion: 1;
  requestId: string;
  phase: 'preparing' | 'unchanged' | 'building' | 'activating' | 'activated' | 'failed';
  sourceBuildId?: string;
  updatedAt: string;
}>;

const phases: readonly WorkspaceActivationPhase[] = [
  'queued',
  'verifying',
  'building',
  'cleaning',
  'retrying',
  'staging',
  'activating',
  'verifying-runtime',
  'activated',
  'failed',
];

const errorCodes: readonly ActivationErrorCode[] = [
  'source_identity_unavailable',
  'workspace_identity_changed',
  'candidate_build_failed',
  'candidate_stage_failed',
  'candidate_verification_failed',
  'activation_rolled_back',
  'host_unavailable',
  'host_identity_mismatch',
  'external_port_owner',
  'runtime_ready_timeout',
  'served_web_build_mismatch',
];

function stringOrUndefined(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

function parseVersionTwo(value: Record<string, unknown>): WorkspaceActivationStatus | undefined {
  const allowed = new Set([
    'schemaVersion',
    'requestId',
    'phase',
    'sourceBuildId',
    'activeBuildId',
    'targetBuildId',
    'attempt',
    'errorCode',
    'errorStage',
    'startedAt',
    'updatedAt',
    'completedAt',
  ]);
  if (
    Object.keys(value).some((key) => !allowed.has(key)) ||
    value.schemaVersion !== 2 ||
    typeof value.requestId !== 'string' ||
    value.requestId === '' ||
    typeof value.phase !== 'string' ||
    !phases.includes(value.phase as WorkspaceActivationPhase) ||
    (value.attempt !== 1 && value.attempt !== 2) ||
    typeof value.startedAt !== 'string' ||
    typeof value.updatedAt !== 'string' ||
    !stringOrUndefined(value.sourceBuildId) ||
    !stringOrUndefined(value.activeBuildId) ||
    !stringOrUndefined(value.targetBuildId) ||
    !stringOrUndefined(value.errorStage) ||
    !stringOrUndefined(value.completedAt) ||
    (value.errorCode !== undefined &&
      (typeof value.errorCode !== 'string' ||
        !errorCodes.includes(value.errorCode as ActivationErrorCode)))
  ) {
    return undefined;
  }
  return value as WorkspaceActivationStatus;
}

function parseLegacy(value: Record<string, unknown>): LegacyStatus | undefined {
  const allowed = new Set(['schemaVersion', 'requestId', 'phase', 'sourceBuildId', 'updatedAt']);
  const legacyPhases: readonly LegacyStatus['phase'][] = [
    'preparing',
    'unchanged',
    'building',
    'activating',
    'activated',
    'failed',
  ];
  if (
    Object.keys(value).some((key) => !allowed.has(key)) ||
    value.schemaVersion !== 1 ||
    typeof value.requestId !== 'string' ||
    value.requestId === '' ||
    typeof value.phase !== 'string' ||
    !legacyPhases.includes(value.phase as LegacyStatus['phase']) ||
    typeof value.updatedAt !== 'string' ||
    !stringOrUndefined(value.sourceBuildId)
  ) {
    return undefined;
  }
  return value as LegacyStatus;
}

export function parseWorkspaceActivationStatus(
  value: unknown,
): WorkspaceActivationStatus | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  const current = parseVersionTwo(input);
  if (current !== undefined) return current;
  const legacy = parseLegacy(input);
  if (legacy === undefined || !['unchanged', 'activated', 'failed'].includes(legacy.phase)) {
    return undefined;
  }
  const activated = legacy.phase === 'unchanged' || legacy.phase === 'activated';
  return {
    schemaVersion: 2,
    requestId: legacy.requestId,
    phase: activated ? 'activated' : 'failed',
    ...(legacy.sourceBuildId === undefined
      ? {}
      : {
          sourceBuildId: legacy.sourceBuildId,
          ...(activated
            ? { activeBuildId: legacy.sourceBuildId, targetBuildId: legacy.sourceBuildId }
            : {}),
        }),
    attempt: 1,
    startedAt: legacy.updatedAt,
    updatedAt: legacy.updatedAt,
    completedAt: legacy.updatedAt,
  };
}

async function writeAtomically(target: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value)}\n`, 'utf8');
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

export interface WorkspaceActivationStatusStore {
  read(): Promise<WorkspaceActivationStatus | undefined>;
  publish(status: WorkspaceActivationStatus): Promise<void>;
}

export function createWorkspaceActivationStatusStore(options: {
  statusPath: string;
}): WorkspaceActivationStatusStore {
  return {
    async read() {
      try {
        return parseWorkspaceActivationStatus(
          JSON.parse(await readFile(options.statusPath, 'utf8')) as unknown,
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        return undefined;
      }
    },
    publish: (status) => writeAtomically(options.statusPath, status),
  };
}

export class WorkspaceActivationFailure extends Error {
  constructor(
    readonly code: ActivationErrorCode,
    readonly stage: string,
  ) {
    super(code);
  }
}

export function activationFailure(
  error: unknown,
  stage: WorkspaceActivationPhase,
): Readonly<{ errorCode: ActivationErrorCode; errorStage: string }> {
  if (error instanceof WorkspaceActivationFailure) {
    return { errorCode: error.code, errorStage: error.stage };
  }
  if (
    error instanceof Error &&
    ['workspace_identity_changed_during_build', 'workspace_changed_during_build'].includes(
      error.message,
    )
  ) {
    return { errorCode: 'workspace_identity_changed', errorStage: 'verifying' };
  }
  const errorCode: ActivationErrorCode =
    stage === 'staging'
      ? 'candidate_stage_failed'
      : stage === 'activating' || stage === 'verifying-runtime'
        ? 'activation_rolled_back'
        : stage === 'verifying'
          ? 'candidate_verification_failed'
          : 'candidate_build_failed';
  return { errorCode, errorStage: stage };
}

export function isTerminalActivationPhase(phase: WorkspaceActivationPhase): boolean {
  return phase === 'activated' || phase === 'failed';
}
