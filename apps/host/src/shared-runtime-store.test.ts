import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { pruneSharedRuntimeStore, shareCandidateRuntime } from './shared-runtime-store.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function candidate(root: string, buildId: string, content = 'node-runtime') {
  const release = path.join(root, buildId);
  await mkdir(path.join(release, 'runtime'), { recursive: true });
  await writeFile(path.join(release, 'runtime', 'node.exe'), content);
  return release;
}

describe('shared release runtime store', () => {
  it('hard-links identical candidate runtimes and collects unreferenced versions', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'learning-more-shared-runtime-'));
    roots.push(root);
    const first = await candidate(root, 'build-a');
    const second = await candidate(root, 'build-b');
    const firstHash = await shareCandidateRuntime(first, root);
    const secondHash = await shareCandidateRuntime(second, root);
    expect(secondHash).toBe(firstHash);
    expect(await readFile(path.join(first, 'runtime', 'node.exe'), 'utf8')).toBe('node-runtime');
    expect((await stat(path.join(first, 'runtime', 'node.exe'))).nlink).toBeGreaterThanOrEqual(3);

    const third = await candidate(root, 'build-c', 'new-node-runtime');
    const thirdHash = await shareCandidateRuntime(third, root);
    await pruneSharedRuntimeStore(root, new Set(['build-a', 'build-b']));
    await expect(
      stat(path.join(root, '.shared-runtime', `${thirdHash}.exe`)),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(
      stat(path.join(root, '.shared-runtime', `${firstHash}.exe`)),
    ).resolves.toBeDefined();
  });
});
