import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, cp, mkdir, mkdtemp, readFile, rename, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { pruneReleaseCache } from './release-retention.js';
import { shareCandidateContent } from './shared-content-store.js';
import { shareCandidateRuntime } from './shared-runtime-store.js';
import type { HostSupervisor } from './supervisor.js';
import {
  activationFailure,
  createWorkspaceActivationStatusStore,
  isTerminalActivationPhase,
  WorkspaceActivationFailure,
  type WorkspaceActivationPhase,
  type WorkspaceActivationStatus,
} from './workspace-activation-status.js';

type WorkspaceActivationRequest = Readonly<{ schemaVersion: 1; requestId: string }>;

export type SourceIdentity = Readonly<{
  buildId: string;
  sourceRevision?: string;
  sourceFingerprint?: string;
  files?: readonly string[];
}>;

export type CandidateBuildContext = Readonly<{
  requestId: string;
  attempt: 1 | 2;
  outputRoot: string;
  workRoot: string;
}>;

function validIdentifier(value: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/u.test(value);
}

function parseRequest(value: unknown): WorkspaceActivationRequest | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const request = value as Record<string, unknown>;
  return request.schemaVersion === 1 &&
    typeof request.requestId === 'string' &&
    validIdentifier(request.requestId)
    ? (request as WorkspaceActivationRequest)
    : undefined;
}

function execute(executable: string, arguments_: readonly string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      [...arguments_],
      { cwd, windowsHide: true, timeout: 10 * 60_000, maxBuffer: 32 * 1024 * 1024 },
      (error) => (error === null ? resolve() : reject(error)),
    );
  });
}

function releaseBridgeEntry(projectRoot: string): string {
  return path.join(projectRoot, 'operations', 'release', 'dist', 'workspace-bridge.js');
}

async function readWorkspaceIdentity(projectRoot: string): Promise<SourceIdentity> {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'learning-more-identity-'));
  const resultPath = path.join(temporaryRoot, `${randomUUID()}.json`);
  try {
    await execute(
      process.execPath,
      [releaseBridgeEntry(projectRoot), 'read-identity', projectRoot, resultPath],
      projectRoot,
    );
    const value = JSON.parse(await readFile(resultPath, 'utf8')) as SourceIdentity;
    if (
      typeof value.buildId !== 'string' ||
      typeof value.sourceRevision !== 'string' ||
      typeof value.sourceFingerprint !== 'string' ||
      !Array.isArray(value.files)
    ) {
      throw new Error('workspace_identity_invalid');
    }
    return value;
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function buildWorkspaceCandidate(
  projectRoot: string,
  context: CandidateBuildContext,
): Promise<Readonly<{ expandedRoot: string; buildId: string }>> {
  const pnpm = path.join(projectRoot, '.corepack', 'v1', 'pnpm', '10.34.3', 'bin', 'pnpm.cjs');
  await access(pnpm);
  await execute(
    process.execPath,
    [
      pnpm,
      '--filter',
      '@learning-more/host',
      '--filter',
      '@learning-more/launcher',
      '--filter',
      '@learning-more/contracts',
      '--filter',
      '@learning-more/ui',
      '--filter',
      '@learning-more/release',
      'build',
    ],
    projectRoot,
  );
  const resultPath = path.join(context.outputRoot, 'candidate-result.json');
  await execute(
    process.execPath,
    [
      releaseBridgeEntry(projectRoot),
      'build-candidate',
      projectRoot,
      context.outputRoot,
      context.workRoot,
      resultPath,
    ],
    projectRoot,
  );
  const value = JSON.parse(await readFile(resultPath, 'utf8')) as Record<string, unknown>;
  if (typeof value.expandedRoot !== 'string' || typeof value.buildId !== 'string') {
    throw new Error('candidate_result_invalid');
  }
  return { expandedRoot: value.expandedRoot, buildId: value.buildId };
}

async function stageCandidate(expandedRoot: string, candidateRoot: string): Promise<void> {
  try {
    await access(candidateRoot);
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const temporary = `${candidateRoot}.staging`;
  try {
    await rm(temporary, { recursive: true, force: true });
    await cp(expandedRoot, temporary, { recursive: true, dereference: true });
    await shareCandidateRuntime(temporary, path.dirname(candidateRoot));
    await shareCandidateContent(temporary, path.dirname(candidateRoot));
    await rename(temporary, candidateRoot);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function commitWorkspaceManifest(
  projectRoot: string,
  _identity: SourceIdentity,
  buildId: string,
): Promise<void> {
  await execute(
    process.execPath,
    [releaseBridgeEntry(projectRoot), 'commit-manifest', projectRoot, buildId],
    projectRoot,
  );
}

function activationAttemptRoot(releasesRoot: string, requestId: string, attempt: 1 | 2): string {
  const requestsRoot = path.resolve(releasesRoot, '.activation-work');
  const attemptRoot = path.resolve(requestsRoot, requestId, `attempt-${attempt}`);
  if (!attemptRoot.startsWith(`${requestsRoot}${path.sep}`)) {
    throw new WorkspaceActivationFailure('candidate_build_failed', 'building');
  }
  return attemptRoot;
}

function releaseRoot(releasesRoot: string, buildId: string): string {
  if (!validIdentifier(buildId)) {
    throw new WorkspaceActivationFailure('candidate_stage_failed', 'staging');
  }
  const root = path.resolve(releasesRoot);
  const candidate = path.resolve(root, buildId);
  if (!candidate.startsWith(`${root}${path.sep}`)) {
    throw new WorkspaceActivationFailure('candidate_stage_failed', 'staging');
  }
  return candidate;
}

export interface WorkspaceActivationWorker {
  start(): void;
  stop(): void;
  processPending(): Promise<void>;
}

export function createWorkspaceActivationWorker(options: {
  projectRoot: string;
  releasesRoot: string;
  requestPath: string;
  statusPath: string;
  supervisor: Pick<HostSupervisor, 'activateCandidate'>;
  readSourceIdentity?(projectRoot: string): Promise<SourceIdentity>;
  readActiveBuildId?(): Promise<string | undefined>;
  buildCandidate?(
    projectRoot: string,
    context: CandidateBuildContext,
  ): Promise<Readonly<{ expandedRoot: string; buildId: string }>>;
  stageCandidate?(expandedRoot: string, candidateRoot: string): Promise<void>;
  commitWorkspaceManifest?(identity: SourceIdentity, buildId: string): Promise<void>;
  pruneReleaseCache?(input: {
    releasesRoot: string;
    activeBuildId: string;
    previousBuildId?: string;
    preserveActivationRequestId?: string;
  }): Promise<unknown>;
  now?(): Date;
  pollMs?: number;
}): WorkspaceActivationWorker {
  const readIdentity = options.readSourceIdentity ?? readWorkspaceIdentity;
  const buildCandidate = options.buildCandidate ?? buildWorkspaceCandidate;
  const stage = options.stageCandidate ?? stageCandidate;
  const commitManifest =
    options.commitWorkspaceManifest ??
    ((identity, buildId) => commitWorkspaceManifest(options.projectRoot, identity, buildId));
  const pruneCache = options.pruneReleaseCache ?? pruneReleaseCache;
  const now = options.now ?? (() => new Date());
  const manifestPath = path.join(options.projectRoot, '.learning-more-build.json');
  const statusStore = createWorkspaceActivationStatusStore({ statusPath: options.statusPath });
  let lastRequestId: string | undefined;
  let inFlight = false;
  let timer: NodeJS.Timeout | undefined;

  const readActiveBuildId =
    options.readActiveBuildId ??
    (async () => {
      try {
        const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { buildId?: unknown };
        return typeof manifest.buildId === 'string' ? manifest.buildId : undefined;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
      }
    });

  const processPending = async () => {
    if (inFlight) return;
    let request: WorkspaceActivationRequest | undefined;
    try {
      request = parseRequest(JSON.parse(await readFile(options.requestPath, 'utf8')) as unknown);
    } catch {
      return;
    }
    if (request === undefined || request.requestId === lastRequestId) return;
    if (lastRequestId === undefined) {
      const previous = await statusStore.read();
      if (previous?.requestId === request.requestId && isTerminalActivationPhase(previous.phase)) {
        lastRequestId = request.requestId;
        return;
      }
    }

    lastRequestId = request.requestId;
    inFlight = true;
    const startedAt = now().toISOString();
    let sourceIdentity: SourceIdentity | undefined;
    let activeBuildId: string | undefined;
    let previousBuildId: string | undefined;
    let targetBuildId: string | undefined;

    const publish = async (
      phase: WorkspaceActivationPhase,
      attempt: 1 | 2,
      fields: Partial<
        Pick<
          WorkspaceActivationStatus,
          'activeBuildId' | 'targetBuildId' | 'errorCode' | 'errorStage' | 'completedAt'
        >
      > = {},
    ) =>
      statusStore.publish({
        schemaVersion: 2,
        requestId: request!.requestId,
        phase,
        ...(sourceIdentity === undefined ? {} : { sourceBuildId: sourceIdentity.buildId }),
        ...(activeBuildId === undefined ? {} : { activeBuildId }),
        ...(targetBuildId === undefined ? {} : { targetBuildId }),
        attempt,
        startedAt,
        updatedAt: now().toISOString(),
        ...fields,
      });

    try {
      try {
        sourceIdentity = await readIdentity(options.projectRoot);
        activeBuildId = await readActiveBuildId();
        previousBuildId = activeBuildId;
      } catch {
        const completedAt = now().toISOString();
        await publish('failed', 1, {
          errorCode: 'source_identity_unavailable',
          errorStage: 'verifying',
          completedAt,
        });
        return;
      }

      await publish('verifying', 1);
      targetBuildId = sourceIdentity.buildId;
      if (sourceIdentity.buildId === activeBuildId) {
        const completedAt = now().toISOString();
        await publish('activated', 1, {
          activeBuildId,
          targetBuildId,
          completedAt,
        });
        return;
      }

      for (const attempt of [1, 2] as const) {
        const attemptRoot = activationAttemptRoot(options.releasesRoot, request.requestId, attempt);
        const outputRoot = path.join(attemptRoot, 'output');
        const workRoot = path.join(attemptRoot, 'work');
        let stageName: WorkspaceActivationPhase = 'building';
        let candidateBuildId: string | undefined;
        try {
          await mkdir(outputRoot, { recursive: true });
          await mkdir(workRoot, { recursive: true });
          await publish('building', attempt);
          const candidate = await buildCandidate(options.projectRoot, {
            requestId: request.requestId,
            attempt,
            outputRoot,
            workRoot,
          });
          candidateBuildId = candidate.buildId;
          targetBuildId = candidate.buildId;
          stageName = 'verifying';
          const finalIdentity = await readIdentity(options.projectRoot);
          if (candidate.buildId !== finalIdentity.buildId) {
            throw new WorkspaceActivationFailure('workspace_identity_changed', 'verifying');
          }
          sourceIdentity = finalIdentity;
          stageName = 'staging';
          await publish('staging', attempt);
          await stage(candidate.expandedRoot, releaseRoot(options.releasesRoot, candidate.buildId));
          const activationIdentity = await readIdentity(options.projectRoot);
          if (candidate.buildId !== activationIdentity.buildId) {
            throw new WorkspaceActivationFailure('workspace_identity_changed', 'verifying');
          }
          sourceIdentity = activationIdentity;
          stageName = 'activating';
          await publish('activating', attempt);
          const result = await options.supervisor.activateCandidate(candidate.buildId);
          if (result.state !== 'activated') {
            activeBuildId = result.activeBuildId;
            throw new WorkspaceActivationFailure('activation_rolled_back', 'activating');
          }
          activeBuildId = result.activeBuildId;
          await publish('verifying-runtime', attempt);
          await commitManifest(finalIdentity, candidate.buildId);
          await rm(attemptRoot, { recursive: true, force: true });
          const completedAt = now().toISOString();
          await publish('activated', attempt, { completedAt });
          await pruneCache({
            releasesRoot: options.releasesRoot,
            activeBuildId,
            ...(previousBuildId === undefined ? {} : { previousBuildId }),
          }).catch(() => undefined);
          return;
        } catch (error) {
          await publish('cleaning', attempt).catch(() => undefined);
          await rm(attemptRoot, { recursive: true, force: true }).catch(() => undefined);
          if (candidateBuildId !== undefined) {
            const currentlyActive = await readActiveBuildId().catch(() => activeBuildId);
            if (currentlyActive !== candidateBuildId) {
              await rm(releaseRoot(options.releasesRoot, candidateBuildId), {
                recursive: true,
                force: true,
              }).catch(() => undefined);
            }
          }
          if (attempt === 1) {
            await publish('retrying', 2);
            continue;
          }
          const failure = activationFailure(error, stageName);
          activeBuildId = await readActiveBuildId().catch(() => activeBuildId);
          const completedAt = now().toISOString();
          await publish('failed', 2, { ...failure, completedAt });
          return;
        }
      }
    } finally {
      await rm(path.dirname(activationAttemptRoot(options.releasesRoot, request.requestId, 1)), {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 200,
      }).catch(() => undefined);
      inFlight = false;
    }
  };

  return {
    start() {
      if (timer !== undefined) return;
      timer = setInterval(() => void processPending(), options.pollMs ?? 200);
      void processPending();
    },
    stop() {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
    },
    processPending,
  };
}
