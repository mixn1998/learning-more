import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';

import { assertSafePathSegment, DataRoot } from './data-root.js';

const entityTypes = [
  'outline-sessions',
  'courses',
  'lesson-progress',
  'lesson-sessions',
  'reviews',
  'lesson-closures',
  'course-reviews',
  'schedules',
  'plan-flows',
  'materials',
  'weekly-reports',
  'learning-notes',
] as const;

const directorySegments = [
  ['locks'],
  ['transactions'],
  ['transactions', 'prepared'],
  ['transactions', 'committed'],
  ['idempotency'],
  ['entities'],
  ...entityTypes.map((entityType) => ['entities', entityType]),
  ['outbox'],
  ['outbox', 'pending'],
  ['outbox', 'receipts'],
  ['events'],
  ['events', 'segments'],
  ['tasks'],
  ['tasks', 'queued'],
  ['tasks', 'active'],
  ['tasks', 'terminal'],
  ['tasks', 'journals'],
  ['indexes'],
  ['read-models'],
  ['global-profile'],
  ['global-profile', 'fact-metrics'],
  ['global-profile', 'time-series'],
  ['global-profile', 'artifact-index'],
  ['global-profile', 'cursors'],
  ['portrait-evidence'],
  ['work'],
  ['quarantine'],
] as const;

export interface StorePaths {
  readonly storeManifest: string;
  readonly eventLogIndex: string;
  aggregate(entityType: string, entityId: string): string;
  requiredDirectories(): readonly string[];
}

export function createStorePaths(dataRoot: DataRoot): StorePaths {
  const observedCase = new Map<string, string>();

  function rejectCaseCollision(namespace: string, value: string): void {
    const key = `${namespace}:${value.toLocaleLowerCase('en-US')}`;
    const existing = observedCase.get(key);
    if (existing !== undefined && existing !== value) throw new Error('PATH_CASE_COLLISION');
    observedCase.set(key, value);
  }

  return {
    storeManifest: dataRoot.resolve('store.json'),
    eventLogIndex: dataRoot.resolve('events', 'event-log.json'),
    aggregate(entityType, entityId) {
      assertSafePathSegment(entityType);
      assertSafePathSegment(entityId);
      rejectCaseCollision('entity-type', entityType);
      rejectCaseCollision(`entity-id:${entityType.toLocaleLowerCase('en-US')}`, entityId);
      const shard = createHash('sha256').update(entityId, 'utf8').digest('hex').slice(0, 2);
      return dataRoot.resolve('entities', entityType, shard, `${entityId}.json`);
    },
    requiredDirectories() {
      return directorySegments.map((segments) => dataRoot.resolve(...segments));
    },
  };
}

export async function initializeStoreLayout(paths: StorePaths): Promise<void> {
  await Promise.all(
    paths.requiredDirectories().map((directory) => mkdir(directory, { recursive: true })),
  );
  try {
    await writeFile(
      paths.storeManifest,
      `${JSON.stringify({
        storeId: `store_${randomUUID()}`,
        formatVersion: 1,
        minimumReaderVersion: 1,
        createdAt: new Date().toISOString(),
        lastCommittedTransactionId: '',
        lastCommittedSequence: 0,
        timezone: 'Asia/Shanghai',
        checksumAlgorithm: 'sha256',
      })}\n`,
      { encoding: 'utf8', flag: 'wx' },
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
}
