import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { PersonalizationDigestRecord } from '../modules/global-user-profile/ports/personalization-digest-repository.js';
import { DataRoot } from './data-root.js';
import { createStorePaths, initializeStoreLayout } from './paths.js';
import { createLocalFilePersonalizationDigestRepository } from './personalization-digest-repositories.js';
import { createUnitOfWork } from './unit-of-work.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('LocalFilePersonalizationDigestRepository', () => {
  it('does not expose a pre-semantic-core snapshot as the last successful teaching digest', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'learning-more-legacy-digest-'));
    roots.push(directory);
    const dataRoot = DataRoot.create(directory);
    await initializeStoreLayout(createStorePaths(dataRoot));
    const repository = createLocalFilePersonalizationDigestRepository(dataRoot);
    const unitOfWork = createUnitOfWork({ dataRoot });
    const legacy = {
      digestId: 'interactive_teaching',
      resourceVersion: 0,
      requestedProfileVersion: 9,
      requestedSourceSnapshotHash: 'a'.repeat(64),
      refreshStatus: 'succeeded',
      latestSuccessful: {
        profileVersion: 9,
        sourceSnapshotHash: 'a'.repeat(64),
        summary: '旧版确定性拼接后截断的五百字摘要',
        sourceRefs: ['legacy:reasoning-analysis'],
        generatedAt: '2026-07-20T00:00:00.000Z',
      },
      updatedAt: '2026-07-20T00:00:00.000Z',
    } as unknown as PersonalizationDigestRecord;

    await unitOfWork.execute({ transactionId: 'tx_seed_legacy_digest' }, (tx) =>
      repository.save(tx, legacy, 0),
    );

    await expect(repository.get()).resolves.toMatchObject({
      resourceVersion: 1,
      refreshStatus: 'succeeded',
      latestSuccessful: undefined,
    });
  });
});
