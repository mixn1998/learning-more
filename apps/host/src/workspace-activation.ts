import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { HostSupervisor } from './supervisor.js';

type WorkspaceActivationPhase =
  'preparing' | 'unchanged' | 'building' | 'activating' | 'activated' | 'failed';

type WorkspaceActivationRequest = Readonly<{ schemaVersion: 1; requestId: string }>;

type WorkspaceActivationStatus = Readonly<{
  schemaVersion: 1;
  requestId: string;
  phase: WorkspaceActivationPhase;
  sourceBuildId?: string;
  updatedAt: string;
}>;

type SourceIdentity = Readonly<{ buildId: string }>;

function parseRequest(value: unknown): WorkspaceActivationRequest | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const request = value as Record<string, unknown>;
  return request.schemaVersion === 1 &&
    typeof request.requestId === 'string' &&
    request.requestId !== ''
    ? (request as WorkspaceActivationRequest)
    : undefined;
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

function execute(executable: string, arguments_: readonly string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(executable, [...arguments_], { cwd, windowsHide: true }, (error) =>
      error === null ? resolve() : reject(error),
    );
  });
}

async function importReleaseModule<T>(projectRoot: string, relativePath: string): Promise<T> {
  return import(pathToFileURL(path.join(projectRoot, relativePath)).href) as Promise<T>;
}

async function readWorkspaceIdentity(projectRoot: string): Promise<SourceIdentity> {
  const module = await importReleaseModule<{
    readSourceIdentity(root: string): Promise<SourceIdentity>;
  }>(projectRoot, path.join('tools', 'release', 'dist', 'source-identity.js'));
  return module.readSourceIdentity(projectRoot);
}

async function buildWorkspaceCandidate(
  projectRoot: string,
): Promise<Readonly<{ expandedRoot: string; buildId: string }>> {
  const pnpm = path.join(projectRoot, '.corepack', 'v1', 'pnpm', '10.34.3', 'bin', 'pnpm.cjs');
  await access(pnpm);
  // The portable release builder owns the single Web build. Running the root
  // recursive build here first would build Web twice and can change generated
  // source artifacts between the identity checks, making a valid release look
  // stale. Precompile only packages whose outputs are copied into the release.
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
      'build',
    ],
    projectRoot,
  );
  const module = await importReleaseModule<{
    buildPortableRelease(
      root: string,
    ): Promise<Readonly<{ expandedRoot: string; buildId: string }>>;
  }>(projectRoot, path.join('tools', 'release', 'dist', 'build-portable.js'));
  return module.buildPortableRelease(projectRoot);
}

async function stageCandidate(expandedRoot: string, candidateRoot: string): Promise<void> {
  try {
    await access(candidateRoot);
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const temporary = `${candidateRoot}.${randomUUID()}.tmp`;
  try {
    await cp(expandedRoot, temporary, { recursive: true, dereference: true });
    await rename(temporary, candidateRoot);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
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
  ): Promise<Readonly<{ expandedRoot: string; buildId: string }>>;
  stageCandidate?(expandedRoot: string, candidateRoot: string): Promise<void>;
  now?(): Date;
  pollMs?: number;
}): WorkspaceActivationWorker {
  const readIdentity = options.readSourceIdentity ?? readWorkspaceIdentity;
  const buildCandidate = options.buildCandidate ?? buildWorkspaceCandidate;
  const stage = options.stageCandidate ?? stageCandidate;
  const now = options.now ?? (() => new Date());
  const manifestPath = path.join(options.projectRoot, '.learning-more-build.json');
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

  const publish = async (
    requestId: string,
    phase: WorkspaceActivationPhase,
    sourceBuildId?: string,
  ) =>
    writeAtomically(options.statusPath, {
      schemaVersion: 1,
      requestId,
      phase,
      ...(sourceBuildId === undefined ? {} : { sourceBuildId }),
      updatedAt: now().toISOString(),
    } satisfies WorkspaceActivationStatus);

  const restoreManifest = async (backup: Buffer | undefined) => {
    if (backup === undefined) {
      await rm(manifestPath, { force: true });
      return;
    }
    await writeAtomically(manifestPath, JSON.parse(backup.toString('utf8')));
  };

  const processPending = async () => {
    if (inFlight) return;
    let request: WorkspaceActivationRequest | undefined;
    try {
      request = parseRequest(JSON.parse(await readFile(options.requestPath, 'utf8')) as unknown);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      return;
    }
    if (request === undefined || request.requestId === lastRequestId) return;
    lastRequestId = request.requestId;
    inFlight = true;
    let backup: Buffer | undefined;
    try {
      const identity = await readIdentity(options.projectRoot);
      const activeBuildId = await readActiveBuildId();
      if (identity.buildId === activeBuildId) {
        await publish(request.requestId, 'unchanged', identity.buildId);
        return;
      }
      await publish(request.requestId, 'preparing', identity.buildId);
      try {
        backup = await readFile(manifestPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      await publish(request.requestId, 'building', identity.buildId);
      const candidate = await buildCandidate(options.projectRoot);
      const finalIdentity = await readIdentity(options.projectRoot);
      if (candidate.buildId !== finalIdentity.buildId)
        throw new Error('workspace_identity_changed_during_build');
      await stage(candidate.expandedRoot, path.join(options.releasesRoot, candidate.buildId));
      await publish(request.requestId, 'activating', candidate.buildId);
      const result = await options.supervisor.activateCandidate(candidate.buildId);
      if (result.state !== 'activated') throw new Error('workspace_activation_rolled_back');
      await publish(request.requestId, 'activated', candidate.buildId);
    } catch {
      await restoreManifest(backup).catch(() => undefined);
      await publish(request.requestId, 'failed').catch(() => undefined);
    } finally {
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
