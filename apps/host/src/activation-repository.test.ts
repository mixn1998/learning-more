import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createActivationRepository } from './activation-repository.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'learning-more-activation-'));
  roots.push(root);
  const releasesRoot = path.join(root, 'releases');
  await mkdir(path.join(releasesRoot, 'build-a'), { recursive: true });
  await mkdir(path.join(releasesRoot, 'build-b'), { recursive: true });
  return createActivationRepository({
    statePath: path.join(root, 'host-state.json'),
    releasesRoot,
    initialActiveBuildId: 'build-a',
  });
}

describe('Host release activation repository', () => {
  it('keeps active unchanged until candidate health commits', async () => {
    const repository = await fixture();

    await repository.prepare('build-b');
    await expect(repository.current()).resolves.toMatchObject({
      phase: 'prepared',
      activeBuildId: 'build-a',
      candidateBuildId: 'build-b',
    });
    await repository.commit('build-b');
    await expect(repository.current()).resolves.toEqual(
      expect.objectContaining({
        phase: 'stable',
        activeBuildId: 'build-b',
        previousBuildId: 'build-a',
      }),
    );
  });

  it('recovers an interrupted prepared activation to the previous healthy release', async () => {
    const repository = await fixture();
    await repository.prepare('build-b');

    await expect(repository.recover()).resolves.toMatchObject({
      phase: 'stable',
      activeBuildId: 'build-a',
    });
  });

  it('rejects traversal and a candidate absent from the versioned release root', async () => {
    const repository = await fixture();

    await expect(repository.prepare('../outside')).rejects.toThrow('release_build_id_invalid');
    await expect(repository.prepare('build-missing')).rejects.toThrow('release_candidate_missing');
  });
});
