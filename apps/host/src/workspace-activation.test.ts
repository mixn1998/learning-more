import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
  it('builds and activates a changed workspace through Host supervision', async () => {
    const input = await fixture();
    const buildCandidate = vi
      .fn()
      .mockResolvedValue({ expandedRoot: 'D:\\candidate', buildId: 'build-new' });
    const stageCandidate = vi.fn().mockResolvedValue(undefined);
    const activateCandidate = vi
      .fn()
      .mockResolvedValue({ state: 'activated', activeBuildId: 'build-new' });
    const worker = createWorkspaceActivationWorker({
      projectRoot: input.root,
      releasesRoot: path.join(input.root, 'releases'),
      requestPath: input.requestPath,
      statusPath: input.statusPath,
      readSourceIdentity: vi.fn().mockResolvedValue({ buildId: 'build-new' }),
      buildCandidate,
      stageCandidate,
      supervisor: { activateCandidate },
    });

    await worker.processPending();

    expect(buildCandidate).toHaveBeenCalledWith(input.root);
    expect(stageCandidate).toHaveBeenCalledWith(
      'D:\\candidate',
      path.join(input.root, 'releases', 'build-new'),
    );
    expect(activateCandidate).toHaveBeenCalledWith('build-new');
    expect(JSON.parse(await readFile(input.statusPath, 'utf8'))).toMatchObject({
      requestId: 'request-1',
      phase: 'activated',
      sourceBuildId: 'build-new',
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
      phase: 'unchanged',
      sourceBuildId: 'build-old',
    });
  });

  it('restores the prior workspace manifest when activation rolls back', async () => {
    const input = await fixture();
    const worker = createWorkspaceActivationWorker({
      projectRoot: input.root,
      releasesRoot: path.join(input.root, 'releases'),
      requestPath: input.requestPath,
      statusPath: input.statusPath,
      readSourceIdentity: vi.fn().mockResolvedValue({ buildId: 'build-new' }),
      buildCandidate: async () => {
        await writeFile(input.manifestPath, '{"buildId":"build-new"}\n', 'utf8');
        return { expandedRoot: 'D:\\candidate', buildId: 'build-new' };
      },
      stageCandidate: vi.fn().mockResolvedValue(undefined),
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
    expect(JSON.parse(await readFile(input.statusPath, 'utf8'))).toMatchObject({ phase: 'failed' });
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
