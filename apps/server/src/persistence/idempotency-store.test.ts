import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { CommandResult } from '@learning-more/contracts';

import { DataRoot } from './data-root.js';
import { createIdempotencyStore } from './idempotency-store.js';
import { createStorePaths, initializeStoreLayout } from './paths.js';
import { createUnitOfWork } from './unit-of-work.js';

const temporaryRoots: string[] = [];

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'learning-more-idempotency-'));
  temporaryRoots.push(directory);
  const dataRoot = DataRoot.create(directory);
  await initializeStoreLayout(createStorePaths(dataRoot));
  const unitOfWork = createUnitOfWork({ dataRoot });
  return { unitOfWork, store: createIdempotencyStore(dataRoot, unitOfWork) };
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe('IdempotencyStore', () => {
  it('replays the original command result for the same key and request hash', async () => {
    const { store, unitOfWork } = await fixture();
    const result: CommandResult<{ courseId: string }> = {
      commandId: 'command_01',
      outcome: 'completed',
      value: { courseId: 'course_01' },
      resourceVersion: 1,
    };

    await expect(store.begin('create-course', 'sha256:request-a')).resolves.toBe('new');
    await expect(store.begin('create-course', 'sha256:request-a')).resolves.toBe('in-flight');
    await unitOfWork.execute({ transactionId: 'tx_complete' }, async (tx) => {
      await store.complete(tx, 'create-course', 'sha256:request-a', result);
    });

    await expect(store.replay('create-course', 'sha256:request-a')).resolves.toEqual(result);
  });

  it('rejects reuse of an idempotency key with a different request hash', async () => {
    const { store } = await fixture();
    await store.begin('create-course', 'sha256:request-a');

    await expect(store.begin('create-course', 'sha256:request-b')).rejects.toMatchObject({
      code: 'idempotency_conflict',
    });
    await expect(store.replay('create-course', 'sha256:request-b')).rejects.toMatchObject({
      code: 'idempotency_conflict',
    });
  });
});
