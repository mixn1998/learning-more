import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { DataRoot } from './data-root.js';
import { createMarkdownArtifactStore } from './markdown-artifact-store.js';
import { createStorePaths, initializeStoreLayout } from './paths.js';
import { createUnitOfWork } from './unit-of-work.js';

const roots: string[] = [];

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'learning-more-artifact-'));
  roots.push(directory);
  const dataRoot = DataRoot.create(directory);
  await initializeStoreLayout(createStorePaths(dataRoot));
  return createMarkdownArtifactStore(dataRoot, createUnitOfWork({ dataRoot }));
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe('MarkdownArtifactStore', () => {
  it('atomically finalizes content and permanently rejects immutable overwrite', async () => {
    const store = await fixture();
    await store.saveDraft('artifact_01', '# 部分');
    await store.finalize({
      artifactId: 'artifact_01',
      kind: 'lesson-review',
      content: '# 最终\n',
      immutable: true,
    });

    await expect(store.read('artifact_01')).resolves.toMatchObject({
      content: '# 最终\n',
      immutable: true,
    });
    await expect(
      store.finalize({
        artifactId: 'artifact_01',
        kind: 'lesson-review',
        content: '# 覆盖',
        immutable: true,
      }),
    ).rejects.toMatchObject({ code: 'immutable_resource' });
  });

  it('keeps an interrupted draft when finalization has not committed', async () => {
    const store = await fixture();
    await store.saveDraft('artifact_failed', '# 已接收 delta');

    await expect(store.readDraft('artifact_failed')).resolves.toBe('# 已接收 delta');
    await expect(store.read('artifact_failed')).resolves.toBeUndefined();
  });

  it('maps logical artifact references with path delimiters to safe storage paths', async () => {
    const store = await fixture();
    const artifactId = 'assistant-message:message_01';
    await store.saveDraft(artifactId, '# AI 回复');

    await expect(store.readDraft(artifactId)).resolves.toBe('# AI 回复');
    await store.finalize({
      artifactId,
      kind: 'assistant-message',
      content: '# AI 回复',
      immutable: true,
    });
    await expect(store.read(artifactId)).resolves.toMatchObject({
      artifactId,
      kind: 'assistant-message',
      content: '# AI 回复',
    });
  });
});
