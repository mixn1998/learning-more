import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { runWorkspaceBridge } from './workspace-bridge.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('workspace release bridge', () => {
  it('rejects ambiguous or relative command paths', async () => {
    await expect(runWorkspaceBridge(['read-identity', '.', 'result.json'])).rejects.toThrow(
      'workspace_bridge_project_root_invalid',
    );
  });

  it('rejects committing a manifest for a different current workspace identity', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'learning-more-bridge-'));
    roots.push(root);
    await writeFile(path.join(root, 'package.json'), '{}\n', 'utf8');

    await expect(
      runWorkspaceBridge(['commit-manifest', root, 'build-that-cannot-match']),
    ).rejects.toThrow();
    await expect(readFile(path.join(root, '.learning-more-build.json'), 'utf8')).rejects.toThrow();
  });
});
