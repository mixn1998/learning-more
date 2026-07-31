import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createWorkspaceActivationWorker } from './workspace-activation.js';

const roots: string[] = [];

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'learning-more-activation-'));
  roots.push(root);
  const requestPath = path.join(root, 'request.json');
  const statusPath = path.join(root, 'status.json');
  const manifestPath = path.join(root, '.learning-more-build.json');
  await writeFile(manifestPath, '{"buildId":"build-old"}\n', 'utf8');
  await writeFile(requestPath, '{"schemaVersion":1,"requestId":"request-1"}\n', 'utf8');
  return { root, requestPath, statusPath, manifestPath };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('workspace activation worker', () => {
  it('cleans the failed request attempt and activates the second candidate', async () => {
    const input = await fixture();
    const failedAttemptMarker = path.join(
      input.root,
      'releases',
      '.activation-work',
      'request-1',
      'attempt-1',
      'work',
      'partial.txt',
    );
    const buildCandidate = vi.fn(async (_projectRoot, context) => {
      if (context.attempt === 1) {
        await writeFile(failedAttemptMarker, 'partial', { encoding: 'utf8', flag: 'w' });
        throw new Error('build_failed');
      }
      return { expandedRoot: 'D:\\candidate', buildId: 'build-new' };
    });
    const commitWorkspaceManifest = vi.fn().mockResolvedValue(undefined);
    const pruneReleaseCache = vi.fn().mockResolvedValue(undefined);
    const worker = createWorkspaceActivationWorker({
      projectRoot: input.root,
      releasesRoot: path.join(input.root, 'releases'),
      requestPath: input.requestPath,
      statusPath: input.statusPath,
      readSourceIdentity: vi.fn().mockResolvedValue({ buildId: 'build-new' }),
      readActiveBuildId: vi.fn().mockResolvedValue('build-old'),
      buildCandidate,
      stageCandidate: vi.fn().mockResolvedValue(undefined),
      commitWorkspaceManifest,
      pruneReleaseCache,
      supervisor: {
        activateCandidate: vi
          .fn()
          .mockResolvedValue({ state: 'activated', activeBuildId: 'build-new' }),
      },
    });

    await worker.processPending();

    expect(buildCandidate).toHaveBeenCalledTimes(2);
    await expect(readFile(failedAttemptMarker, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(commitWorkspaceManifest).toHaveBeenCalledWith(
      expect.objectContaining({ buildId: 'build-new' }),
      'build-new',
    );
    expect(pruneReleaseCache).toHaveBeenCalledWith({
      releasesRoot: path.join(input.root, 'releases'),
      activeBuildId: 'build-new',
      previousBuildId: 'build-old',
    });
    await expect(
      access(path.join(input.root, 'releases', '.activation-work', 'request-1')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    expect(JSON.parse(await readFile(input.statusPath, 'utf8'))).toMatchObject({
      schemaVersion: 2,
      requestId: 'request-1',
      phase: 'activated',
      attempt: 2,
      activeBuildId: 'build-new',
      targetBuildId: 'build-new',
    });
  });

  it('builds and activates a changed workspace through Host supervision', async () => {
    const input = await fixture();
    const buildCandidate = vi
      .fn()
      .mockResolvedValue({ expandedRoot: 'D:\\candidate', buildId: 'build-new' });
    const stageCandidate = vi.fn().mockResolvedValue(undefined);
    const activateCandidate = vi
      .fn()
      .mockResolvedValue({ state: 'activated', activeBuildId: 'build-new' });
    const commitWorkspaceManifest = vi.fn().mockResolvedValue(undefined);
    const pruneReleaseCache = vi.fn().mockResolvedValue(undefined);
    const worker = createWorkspaceActivationWorker({
      projectRoot: input.root,
      releasesRoot: path.join(input.root, 'releases'),
      requestPath: input.requestPath,
      statusPath: input.statusPath,
      readSourceIdentity: vi.fn().mockResolvedValue({ buildId: 'build-new' }),
      buildCandidate,
      stageCandidate,
      commitWorkspaceManifest,
      pruneReleaseCache,
      supervisor: { activateCandidate },
    });

    await worker.processPending();

    expect(buildCandidate).toHaveBeenCalledWith(
      input.root,
      expect.objectContaining({ requestId: 'request-1', attempt: 1 }),
    );
    expect(stageCandidate).toHaveBeenCalledWith(
      'D:\\candidate',
      path.join(input.root, 'releases', 'build-new'),
    );
    expect(activateCandidate).toHaveBeenCalledWith('build-new');
    expect(commitWorkspaceManifest).toHaveBeenCalledOnce();
    expect(pruneReleaseCache).toHaveBeenCalledOnce();
    expect(JSON.parse(await readFile(input.statusPath, 'utf8'))).toMatchObject({
      schemaVersion: 2,
      requestId: 'request-1',
      phase: 'activated',
      sourceBuildId: 'build-new',
      activeBuildId: 'build-new',
      attempt: 1,
    });
  });

  it('does not build when the active manifest already matches the workspace', async () => {
    const input = await fixture();
    const buildCandidate = vi.fn();
    const worker = createWorkspaceActivationWorker({
      projectRoot: input.root,
      releasesRoot: path.join(input.root, 'releases'),
      requestPath: input.requestPath,
      statusPath: input.statusPath,
      readSourceIdentity: vi.fn().mockResolvedValue({ buildId: 'build-old' }),
      buildCandidate,
      supervisor: { activateCandidate: vi.fn() },
    });

    await worker.processPending();

    expect(buildCandidate).not.toHaveBeenCalled();
    expect(JSON.parse(await readFile(input.statusPath, 'utf8'))).toMatchObject({
      schemaVersion: 2,
      phase: 'activated',
      sourceBuildId: 'build-old',
      activeBuildId: 'build-old',
    });
  });

  it('keeps the prior workspace manifest when activation rolls back', async () => {
    const input = await fixture();
    const commitWorkspaceManifest = vi.fn();
    const pruneReleaseCache = vi.fn();
    const worker = createWorkspaceActivationWorker({
      projectRoot: input.root,
      releasesRoot: path.join(input.root, 'releases'),
      requestPath: input.requestPath,
      statusPath: input.statusPath,
      readSourceIdentity: vi.fn().mockResolvedValue({ buildId: 'build-new' }),
      readActiveBuildId: vi.fn().mockResolvedValue('build-old'),
      buildCandidate: async () => ({ expandedRoot: 'D:\\candidate', buildId: 'build-new' }),
      stageCandidate: vi.fn().mockResolvedValue(undefined),
      commitWorkspaceManifest,
      pruneReleaseCache,
      supervisor: {
        activateCandidate: vi.fn().mockResolvedValue({
          state: 'rolled-back',
          activeBuildId: 'build-old',
          failedCandidateBuildId: 'build-new',
        }),
      },
    });

    await worker.processPending();

    expect(await readFile(input.manifestPath, 'utf8')).toBe('{"buildId":"build-old"}\n');
    expect(commitWorkspaceManifest).not.toHaveBeenCalled();
    expect(pruneReleaseCache).not.toHaveBeenCalled();
    await expect(
      access(path.join(input.root, 'releases', '.activation-work', 'request-1')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    expect(JSON.parse(await readFile(input.statusPath, 'utf8'))).toMatchObject({
      schemaVersion: 2,
      phase: 'failed',
      attempt: 2,
      activeBuildId: 'build-old',
      targetBuildId: 'build-new',
      errorCode: 'activation_rolled_back',
    });
  });

  it('does not retry a terminal request after Host restarts', async () => {
    const input = await fixture();
    await writeFile(
      input.statusPath,
      `${JSON.stringify({
        schemaVersion: 1,
        requestId: 'request-1',
        phase: 'failed',
        updatedAt: '2026-07-15T00:00:00.000Z',
      })}\n`,
      'utf8',
    );
    const buildCandidate = vi.fn();
    const readSourceIdentity = vi.fn();
    const worker = createWorkspaceActivationWorker({
      projectRoot: input.root,
      releasesRoot: path.join(input.root, 'releases'),
      requestPath: input.requestPath,
      statusPath: input.statusPath,
      readSourceIdentity,
      buildCandidate,
      supervisor: { activateCandidate: vi.fn() },
    });

    await worker.processPending();

    expect(readSourceIdentity).not.toHaveBeenCalled();
    expect(buildCandidate).not.toHaveBeenCalled();
    expect(JSON.parse(await readFile(input.statusPath, 'utf8'))).toMatchObject({
      requestId: 'request-1',
      phase: 'failed',
    });
  });
});
