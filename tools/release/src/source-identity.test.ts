import { mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  assertWorkspaceUnchanged,
  computeSourceFingerprint,
  formatBuildId,
  writeWorkspaceBuildManifest,
} from './source-identity.js';

const temporaryRoots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'learning-more-source-identity-'));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe('release source identity', () => {
  it('is deterministic for the same ordered workspace contents', async () => {
    const root = await temporaryRoot();
    await writeFile(path.join(root, 'tracked.ts'), 'export const value = 1;\n', 'utf8');
    await writeFile(path.join(root, 'untracked.txt'), 'draft\n', 'utf8');

    const first = await computeSourceFingerprint(root, ['untracked.txt', 'tracked.ts']);
    const second = await computeSourceFingerprint(root, ['tracked.ts', 'untracked.txt']);

    expect(second).toBe(first);
    expect(first).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('changes when an untracked file changes or a tracked file becomes deleted', async () => {
    const root = await temporaryRoot();
    const tracked = path.join(root, 'tracked.ts');
    const untracked = path.join(root, 'untracked.txt');
    await writeFile(tracked, 'before\n', 'utf8');
    await writeFile(untracked, 'draft-a\n', 'utf8');
    const original = await computeSourceFingerprint(root, ['tracked.ts', 'untracked.txt']);

    await writeFile(untracked, 'draft-b\n', 'utf8');
    const changed = await computeSourceFingerprint(root, ['tracked.ts', 'untracked.txt']);
    await unlink(tracked);
    const deleted = await computeSourceFingerprint(root, ['tracked.ts', 'untracked.txt']);

    expect(changed).not.toBe(original);
    expect(deleted).not.toBe(changed);
  });

  it('creates a traceable safe build id and rejects build-time source drift', () => {
    const before = 'a'.repeat(64);
    const after = 'b'.repeat(64);

    expect(formatBuildId('f464201eddda', before)).toBe('f464201eddda-waaaaaaaaaaaa');
    expect(() => assertWorkspaceUnchanged(before, before)).not.toThrow();
    expect(() => assertWorkspaceUnchanged(before, after)).toThrowError(
      'workspace_changed_during_build',
    );
  });

  it('writes the integrated workspace identity consumed by the Host', async () => {
    const root = await temporaryRoot();
    const sourceFingerprint = 'c'.repeat(64);
    const identity = {
      sourceRevision: 'f464201eddda4fa9a06d23c47249abb3885e1c9f',
      sourceFingerprint,
      buildId: formatBuildId('f464201eddda', sourceFingerprint),
      files: ['tracked.ts'],
    };

    await writeWorkspaceBuildManifest(root, identity);

    await expect(
      import('node:fs/promises').then(({ readFile }) =>
        readFile(path.join(root, '.learning-more-build.json'), 'utf8').then(JSON.parse),
      ),
    ).resolves.toMatchObject({
      schemaVersion: 1,
      buildId: identity.buildId,
      sourceRevision: identity.sourceRevision,
      sourceFingerprint,
    });
  });
});
