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

export type WorkspaceActivationProgress = Readonly<{
  schemaVersion: 2;
  requestId: string;
  phase:
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

export type WorkspaceActivationResult =
  | Readonly<{ mode: 'reconnect'; activation?: WorkspaceActivationProgress }>
  | Readonly<{
      mode: 'activate';
      targetBuildId: string;
      activation: WorkspaceActivationProgress;
    }>;

const phases: readonly WorkspaceActivationProgress['phase'][] = [
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

function optionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

function parseVersionTwo(input: Record<string, unknown>): WorkspaceActivationProgress | undefined {
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
    Object.keys(input).some((key) => !allowed.has(key)) ||
    input.schemaVersion !== 2 ||
    typeof input.requestId !== 'string' ||
    typeof input.phase !== 'string' ||
    !phases.includes(input.phase as WorkspaceActivationProgress['phase']) ||
    (input.attempt !== 1 && input.attempt !== 2) ||
    typeof input.startedAt !== 'string' ||
    typeof input.updatedAt !== 'string' ||
    !optionalString(input.sourceBuildId) ||
    !optionalString(input.activeBuildId) ||
    !optionalString(input.targetBuildId) ||
    !optionalString(input.errorStage) ||
    !optionalString(input.completedAt) ||
    (input.errorCode !== undefined &&
      (typeof input.errorCode !== 'string' ||
        !errorCodes.includes(input.errorCode as ActivationErrorCode)))
  ) {
    return undefined;
  }
  return input as WorkspaceActivationProgress;
}

function parseLegacy(input: Record<string, unknown>): WorkspaceActivationProgress | undefined {
  const allowed = new Set(['schemaVersion', 'requestId', 'phase', 'sourceBuildId', 'updatedAt']);
  const legacyPhases = ['preparing', 'unchanged', 'building', 'activating', 'activated', 'failed'];
  if (
    Object.keys(input).some((key) => !allowed.has(key)) ||
    input.schemaVersion !== 1 ||
    typeof input.requestId !== 'string' ||
    typeof input.phase !== 'string' ||
    !legacyPhases.includes(input.phase) ||
    !optionalString(input.sourceBuildId)
  ) {
    return undefined;
  }
  const updatedAt =
    typeof input.updatedAt === 'string' ? input.updatedAt : new Date(0).toISOString();
  const phase =
    input.phase === 'preparing'
      ? 'verifying'
      : input.phase === 'unchanged'
        ? 'activated'
        : input.phase;
  return {
    schemaVersion: 2,
    requestId: input.requestId,
    phase,
    ...(input.sourceBuildId === undefined
      ? {}
      : {
          sourceBuildId: input.sourceBuildId,
          targetBuildId: input.sourceBuildId,
          ...(phase === 'activated' ? { activeBuildId: input.sourceBuildId } : {}),
        }),
    attempt: 1,
    ...(phase === 'failed' ? { errorCode: 'candidate_build_failed' as const } : {}),
    startedAt: updatedAt,
    updatedAt,
    ...(['activated', 'failed'].includes(phase) ? { completedAt: updatedAt } : {}),
  } as WorkspaceActivationProgress;
}

function parseStatus(value: unknown): WorkspaceActivationProgress | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  return parseVersionTwo(input) ?? parseLegacy(input);
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

export async function readWorkspaceActivationStatus(options: {
  statusPath: string;
}): Promise<WorkspaceActivationProgress | undefined> {
  try {
    return parseStatus(JSON.parse(await readFile(options.statusPath, 'utf8')) as unknown);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    return undefined;
  }
}

export class WorkspaceActivationError extends Error {
  constructor(
    readonly code: ActivationErrorCode,
    readonly activation?: WorkspaceActivationProgress,
  ) {
    super(code);
  }
}

export async function requestWorkspaceActivation(options: {
  requestPath: string;
  statusPath: string;
  repairHost?(): Promise<void>;
  wait?(delayMs: number): Promise<void>;
  now?(): number;
  acknowledgementMs?: number;
  timeoutMs?: number;
}): Promise<WorkspaceActivationResult> {
  const requestId = randomUUID();
  const now = options.now ?? Date.now;
  const wait =
    options.wait ?? ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
  const startedAt = now();
  const acknowledgementAt = startedAt + (options.acknowledgementMs ?? 5_000);
  const deadline = startedAt + (options.timeoutMs ?? 20_000);
  let repairAttempted = false;

  await writeAtomically(options.requestPath, {
    schemaVersion: 1,
    requestId,
    requestedAt: new Date(startedAt).toISOString(),
  });

  while (now() < deadline) {
    const status = await readWorkspaceActivationStatus({ statusPath: options.statusPath });
    if (status?.requestId === requestId) {
      if (status.phase === 'failed') {
        throw new WorkspaceActivationError(status.errorCode ?? 'candidate_build_failed', status);
      }
      const targetBuildId = status.targetBuildId ?? status.sourceBuildId;
      if (targetBuildId !== undefined) {
        return { mode: 'activate', targetBuildId, activation: status };
      }
    }

    if (!repairAttempted && now() >= acknowledgementAt) {
      repairAttempted = true;
      if (options.repairHost === undefined) {
        throw new WorkspaceActivationError('host_unavailable');
      }
      try {
        await options.repairHost();
      } catch {
        throw new WorkspaceActivationError('host_unavailable');
      }
    }
    await wait(100);
  }
  throw new WorkspaceActivationError('host_unavailable');
}
