import { mkdir, mkdtemp, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { pruneSharedContentStore, shareCandidateContent } from './shared-content-store.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function candidate(
  root: string,
  buildId: string,
  nativeContent = 'shared-native-binary',
): Promise<string> {
  const release = path.join(root, buildId);
  await Promise.all([
    mkdir(path.join(release, 'app', 'web'), { recursive: true }),
    mkdir(path.join(release, 'app', 'server'), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      path.join(release, 'release-manifest.json'),
      `${JSON.stringify({ buildId, files: [] })}\n`,
    ),
    writeFile(path.join(release, 'app', 'web', 'index.js'), 'console.log("shared");\n'),
    writeFile(path.join(release, 'app', 'web', 'logo.svg'), '<svg></svg>\n'),
    writeFile(path.join(release, 'app', 'web', 'font.woff2'), 'shared-font'),
    writeFile(path.join(release, 'app', 'server', 'canvas.node'), nativeContent),
    writeFile(path.join(release, 'app', 'server', 'decoder.wasm'), 'shared-wasm'),
    writeFile(path.join(release, 'app', 'server', 'settings.json'), '{"release":true}\n'),
  ]);
  return release;
}

describe('shared immutable release content store', () => {
  it('hard-links identical code, visual assets, and native dependencies by content hash', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'learning-more-shared-content-'));
    roots.push(root);
    const first = await candidate(root, 'build-a');
    const second = await candidate(root, 'build-b');

    const firstManifest = await shareCandidateContent(first, root);
    const secondManifest = await shareCandidateContent(second, root);

    expect(firstManifest.entries.map(({ category }) => category)).toEqual([
      'native',
      'native',
      'visual',
      'code',
      'visual',
    ]);
    expect(secondManifest.entries.map(({ sha256 }) => sha256)).toEqual(
      firstManifest.entries.map(({ sha256 }) => sha256),
    );
    expect((await stat(path.join(first, 'app', 'web', 'index.js'))).nlink).toBeGreaterThanOrEqual(
      3,
    );
    expect(
      (await stat(path.join(second, 'app', 'server', 'canvas.node'))).nlink,
    ).toBeGreaterThanOrEqual(3);
    expect(
      firstManifest.entries.some(({ relativePath }) => relativePath.endsWith('settings.json')),
    ).toBe(false);
    await expect(
      readFile(path.join(root, '.shared-content', 'manifests', 'build-a.json'), 'utf8'),
    ).resolves.toContain('"buildId":"build-a"');
  });

  it('collects only unreferenced objects and stays conservative when a protected manifest is missing', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'learning-more-shared-content-prune-'));
    roots.push(root);
    const first = await candidate(root, 'build-a');
    const second = await candidate(root, 'build-b');
    const third = await candidate(root, 'build-c', 'unique-native-binary');
    await shareCandidateContent(first, root);
    await shareCandidateContent(second, root);
    const thirdManifest = await shareCandidateContent(third, root);
    const unique = thirdManifest.entries.find(
      ({ relativePath }) => relativePath === 'app/server/canvas.node',
    );
    expect(unique).toBeDefined();

    const removed = await pruneSharedContentStore(root, new Set(['build-a', 'build-b']));
    expect(removed).toContain(`native/${unique!.sha256}`);
    await expect(
      stat(path.join(root, '.shared-content', 'native', unique!.sha256)),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(
      stat(path.join(root, '.shared-content', 'manifests', 'build-c.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' });

    const orphan = path.join(root, '.shared-content', 'native', 'orphan');
    await writeFile(orphan, 'orphan');
    await unlink(path.join(root, '.shared-content', 'manifests', 'build-b.json'));
    await expect(pruneSharedContentStore(root, new Set(['build-a', 'build-b']))).resolves.toEqual(
      [],
    );
    await expect(stat(orphan)).resolves.toBeDefined();
  });
});
