import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createWorkspaceActivationWorker } from '../../../apps/host/src/workspace-activation.js';
import {
  requestWorkspaceActivation,
  WorkspaceActivationError,
} from '../../../apps/launcher/src/workspace-activation.js';

const roots: string[] = [];

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'learning-more-activation-flow-'));
  roots.push(root);
  const releasesRoot = path.join(root, 'releases');
  const oldRelease = path.join(releasesRoot, 'build-old');
  const dataRoot = path.join(root, '.learning-more-data');
  const requestPath = path.join(root, 'activation-request.json');
  const statusPath = path.join(root, 'activation-status.json');
  const manifestPath = path.join(root, '.learning-more-build.json');
  await mkdir(oldRelease, { recursive: true });
  await mkdir(dataRoot, { recursive: true });
  await writeFile(path.join(oldRelease, 'ready.marker'), 'old release', 'utf8');
  await writeFile(path.join(dataRoot, 'course.json'), '{"courseId":"course-01"}\n', 'utf8');
  await writeFile(manifestPath, '{"buildId":"build-old"}\n', 'utf8');
  return { root, releasesRoot, oldRelease, dataRoot, requestPath, statusPath, manifestPath };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('Host and Launcher workspace activation flow', () => {
  it('retries one failed candidate and publishes the activated build without touching old data', async () => {
    const input = await fixture();
    let activeBuildId = 'build-old';
    const failedAttemptMarker = path.join(
      input.releasesRoot,
      '.activation-work',
      'request-placeholder',
      'attempt-1',
      'work',
      'partial.txt',
    );
    let actualFailedAttemptMarker = failedAttemptMarker;
    const buildCandidate = vi.fn(async (_projectRoot, context) => {
      if (context.attempt === 1) {
        actualFailedAttemptMarker = path.join(
          input.releasesRoot,
          '.activation-work',
          context.requestId,
          'attempt-1',
          'work',
          'partial.txt',
        );
        await mkdir(path.dirname(actualFailedAttemptMarker), { recursive: true });
        await writeFile(actualFailedAttemptMarker, 'partial', 'utf8');
        throw new Error('compiler output with D:\\private\\workspace');
      }
      return { expandedRoot: path.join(input.root, 'candidate'), buildId: 'build-new' };
    });
    const worker = createWorkspaceActivationWorker({
      projectRoot: input.root,
      releasesRoot: input.releasesRoot,
      requestPath: input.requestPath,
      statusPath: input.statusPath,
      readSourceIdentity: vi.fn().mockResolvedValue({ buildId: 'build-new' }),
      readActiveBuildId: async () => activeBuildId,
      buildCandidate,
      stageCandidate: async (_candidateRoot, releaseRoot) => {
        await mkdir(releaseRoot, { recursive: true });
        await writeFile(path.join(releaseRoot, 'ready.marker'), 'new release', 'utf8');
      },
      commitWorkspaceManifest: async (_identity, buildId) => {
        await writeFile(input.manifestPath, `${JSON.stringify({ buildId })}\n`, 'utf8');
      },
      supervisor: {
        activateCandidate: async (buildId) => {
          activeBuildId = buildId;
          return { state: 'activated' as const, activeBuildId: buildId };
        },
      },
    });

    const result = await requestWorkspaceActivation({
      requestPath: input.requestPath,
      statusPath: input.statusPath,
      wait: async () => worker.processPending(),
    });

    expect(result).toMatchObject({
      mode: 'activate',
      targetBuildId: 'build-new',
      activation: { phase: 'activated', attempt: 2, activeBuildId: 'build-new' },
    });
    expect(buildCandidate).toHaveBeenCalledTimes(2);
    await expect(readFile(actualFailedAttemptMarker, 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(readFile(path.join(input.oldRelease, 'ready.marker'), 'utf8')).resolves.toBe(
      'old release',
    );
    await expect(readFile(path.join(input.dataRoot, 'course.json'), 'utf8')).resolves.toContain(
      'course-01',
    );
  });

  it('keeps the active release and user data after both candidate builds fail', async () => {
    const input = await fixture();
    const worker = createWorkspaceActivationWorker({
      projectRoot: input.root,
      releasesRoot: input.releasesRoot,
      requestPath: input.requestPath,
      statusPath: input.statusPath,
      readSourceIdentity: vi.fn().mockResolvedValue({ buildId: 'build-new' }),
      readActiveBuildId: vi.fn().mockResolvedValue('build-old'),
      buildCandidate: vi.fn().mockRejectedValue(new Error('D:\\private\\secret stack')),
      supervisor: { activateCandidate: vi.fn() },
    });

    const activation = requestWorkspaceActivation({
      requestPath: input.requestPath,
      statusPath: input.statusPath,
      wait: async () => worker.processPending(),
    });

    await expect(activation).rejects.toMatchObject({
      code: 'candidate_build_failed',
      activation: {
        phase: 'failed',
        attempt: 2,
        activeBuildId: 'build-old',
        errorCode: 'candidate_build_failed',
      },
    } satisfies Partial<WorkspaceActivationError>);
    const publicStatus = await readFile(input.statusPath, 'utf8');
    expect(publicStatus).not.toContain('private');
    expect(publicStatus).not.toContain('stack');
    await expect(readFile(path.join(input.oldRelease, 'ready.marker'), 'utf8')).resolves.toBe(
      'old release',
    );
    await expect(readFile(path.join(input.dataRoot, 'course.json'), 'utf8')).resolves.toContain(
      'course-01',
    );
    await expect(readFile(input.manifestPath, 'utf8')).resolves.toBe('{"buildId":"build-old"}\n');
  });
});
