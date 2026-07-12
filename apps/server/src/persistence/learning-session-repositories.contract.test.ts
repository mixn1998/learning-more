import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createLessonLearning,
  decide,
  evolveAll,
} from '../modules/learning-session/model/learning-session.js';
import {
  createInMemoryMessageLog,
  createLocalFileMessageLog,
} from '../modules/learning-session/implementation/message-log.js';
import { DataRoot } from './data-root.js';
import { createStorePaths, initializeStoreLayout } from './paths.js';
import {
  createInMemoryLearningSessionRepositories,
  createLocalFileLearningSessionRepositories,
  type LearningSessionRepositories,
} from './learning-session-repositories.js';
import { RepositoryVersionConflictError } from './repository-errors.js';
import { createUnitOfWork, type UnitOfWork } from './unit-of-work.js';

const roots: string[] = [];
const memoryTx = {
  stageJson: async () => undefined,
  stageText: async () => undefined,
  deleteOnCommit: async () => undefined,
};
const memoryUnitOfWork = {
  async execute<T>(_request: unknown, work: (context: typeof memoryTx) => Promise<T>) {
    return work(memoryTx);
  },
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function localFixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'learning-more-session-repo-'));
  roots.push(directory);
  const dataRoot = DataRoot.create(directory);
  await initializeStoreLayout(createStorePaths(dataRoot));
  const unitOfWork = createUnitOfWork({ dataRoot });
  return {
    repositories: createLocalFileLearningSessionRepositories(dataRoot),
    messageLog: createLocalFileMessageLog(dataRoot),
    unitOfWork,
  };
}

async function repositoryContract(
  repositories: LearningSessionRepositories,
  unitOfWork: UnitOfWork,
) {
  let learning = createLessonLearning('lesson_01');
  learning = evolveAll(
    learning,
    decide(learning, { type: 'start', sessionId: 'session_01' }, 'c1'),
  );
  const record = {
    lessonId: 'lesson_01',
    learning,
    intervals: [
      {
        id: 'interval_01',
        sessionId: 'session_01',
        startedAt: '2026-07-13T00:00:00.000Z',
        endedAt: '2026-07-13T00:00:05.000Z',
        endReason: 'paused' as const,
        recovered: false,
      },
    ],
    writeLease: {
      token: 'lease_01',
      pageInstanceId: 'page_01',
      instanceId: 'instance_01',
      generation: 1,
      heartbeatAt: '2026-07-13T00:00:05.000Z',
      visibilityState: 'visible' as const,
    },
    resourceVersion: 0,
  };
  await unitOfWork.execute({ transactionId: 'tx_create' }, (tx) =>
    repositories.save(tx, record, 0),
  );
  await expect(repositories.get('lesson_01')).resolves.toMatchObject({
    resourceVersion: 1,
    learning: { session: { id: 'session_01' } },
    intervals: [{ endReason: 'paused' }],
    writeLease: { pageInstanceId: 'page_01' },
  });
  await expect(
    unitOfWork.execute({ transactionId: 'tx_stale' }, (tx) => repositories.save(tx, record, 0)),
  ).rejects.toBeInstanceOf(RepositoryVersionConflictError);
  const listed = [];
  for await (const item of repositories.list()) listed.push(item.lessonId);
  expect(listed).toEqual(['lesson_01']);
}

describe('LearningSession repository contracts', () => {
  it('passes for InMemory', async () => {
    await repositoryContract(createInMemoryLearningSessionRepositories(), memoryUnitOfWork);
  });
  it('passes for LocalFile', async () => {
    const fixture = await localFixture();
    await repositoryContract(fixture.repositories, fixture.unitOfWork);
  });
  it.each([
    [
      'InMemory',
      async () => ({ messageLog: createInMemoryMessageLog(), unitOfWork: memoryUnitOfWork }),
    ],
    ['LocalFile', localFixture],
  ])('deduplicates checksum message records for %s', async (_name, create) => {
    const { messageLog, unitOfWork } = await create();
    const message = {
      id: 'message_01',
      role: 'user' as const,
      createdAt: '2026-07-13T00:00:00.000Z',
      contentArtifactRef: 'artifact:01',
    };
    for (const transactionId of ['tx_message_1', 'tx_message_2']) {
      await unitOfWork.execute({ transactionId }, (tx) =>
        messageLog.stageAppend(tx, 'session_01', message),
      );
    }
    await expect(messageLog.list('session_01')).resolves.toEqual([message]);
  });
});
