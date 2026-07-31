import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { pruneReleaseCache } from './release-retention.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'learning-more-release-retention-'));
  roots.push(root);
  const releasesRoot = path.join(root, 'host', 'releases');
  const dataRoot = path.join(root, 'data');
  await Promise.all([
    mkdir(path.join(releasesRoot, 'workspace'), { recursive: true }),
    mkdir(path.join(releasesRoot, '.activation-work', 'finished-request'), { recursive: true }),
    mkdir(dataRoot, { recursive: true }),
  ]);
  await writeFile(path.join(dataRoot, 'courses.json'), 'user data', 'utf8');
  return { root, releasesRoot, dataRoot };
}

async function managedRelease(releasesRoot: string, buildId: string): Promise<void> {
  const directory = path.join(releasesRoot, buildId);
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, 'release-manifest.json'),
    `${JSON.stringify({ buildId })}\n`,
    'utf8',
  );
}

describe('Host release cache retention', () => {
  it('keeps current and previous releases while removing older managed builds', async () => {
    const input = await fixture();
    await Promise.all([
      managedRelease(input.releasesRoot, 'build-current'),
      managedRelease(input.releasesRoot, 'build-previous'),
      managedRelease(input.releasesRoot, 'build-old'),
      mkdir(path.join(input.releasesRoot, 'build-incomplete'), { recursive: true }),
      mkdir(path.join(input.releasesRoot, 'build-abandoned.staging'), { recursive: true }),
      mkdir(path.join(input.releasesRoot, 'build-abandoned.uuid.tmp'), { recursive: true }),
    ]);

    const result = await pruneReleaseCache({
      releasesRoot: input.releasesRoot,
      activeBuildId: 'build-current',
      previousBuildId: 'build-previous',
    });

    await expect(
      readFile(path.join(input.releasesRoot, 'build-current', 'release-manifest.json'), 'utf8'),
    ).resolves.toContain('build-current');
    await expect(
      readFile(path.join(input.releasesRoot, 'build-previous', 'release-manifest.json'), 'utf8'),
    ).resolves.toContain('build-previous');
    await expect(
      readFile(path.join(input.releasesRoot, 'build-old', 'release-manifest.json'), 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(
      readFile(path.join(input.releasesRoot, 'build-incomplete', 'release-manifest.json'), 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readdirNames(path.join(input.releasesRoot, 'build-incomplete'))).resolves.toEqual(
      [],
    );
    expect(result).toMatchObject({
      removedBuildIds: ['build-old'],
      removedTemporaryEntries: ['build-abandoned.staging', 'build-abandoned.uuid.tmp'],
      removedActivationEntries: ['finished-request'],
    });
  });

  it('never crosses the release cache boundary into user data', async () => {
    const input = await fixture();
    await managedRelease(input.releasesRoot, 'build-current');

    await pruneReleaseCache({
      releasesRoot: input.releasesRoot,
      activeBuildId: 'build-current',
    });

    await expect(readFile(path.join(input.dataRoot, 'courses.json'), 'utf8')).resolves.toBe(
      'user data',
    );
  });

  it('can preserve the one activation request that is still in flight', async () => {
    const input = await fixture();
    await managedRelease(input.releasesRoot, 'build-current');
    await mkdir(path.join(input.releasesRoot, '.activation-work', 'active-request'), {
      recursive: true,
    });

    const result = await pruneReleaseCache({
      releasesRoot: input.releasesRoot,
      activeBuildId: 'build-current',
      preserveActivationRequestId: 'active-request',
    });

    expect(result.removedActivationEntries).toEqual(['finished-request']);
    await expect(readdirNames(path.join(input.releasesRoot, '.activation-work'))).resolves.toEqual([
      'active-request',
    ]);
  });
});

async function readdirNames(directory: string): Promise<string[]> {
  return readdir(directory);
}
