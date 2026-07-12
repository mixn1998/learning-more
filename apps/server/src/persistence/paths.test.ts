import { createHash } from 'node:crypto';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { DataRoot } from './data-root.js';
import { createStorePaths, initializeStoreLayout } from './paths.js';

describe('StorePaths', () => {
  it.each(['../secret', 'C:\\outside', '/outside', 'CON', 'LPT1.json'])(
    'rejects unsafe entity types: %s',
    (entityType) => {
      const paths = createStorePaths(DataRoot.create(path.resolve('test-data')));

      expect(() => paths.aggregate(entityType, 'course_01')).toThrow('PATH_OUTSIDE_DATA_ROOT');
    },
  );

  it('rejects entity ids that collide by case', () => {
    const paths = createStorePaths(DataRoot.create(path.resolve('test-data')));
    paths.aggregate('courses', 'Course_01');

    expect(() => paths.aggregate('courses', 'course_01')).toThrow('PATH_CASE_COLLISION');
  });

  it('shards aggregate documents by the first two sha256 characters of the id', () => {
    const root = DataRoot.create(path.resolve('test-data'));
    const paths = createStorePaths(root);
    const entityId = 'course_0198f4f0-1234-7000-8000-000000000001';
    const shard = createHash('sha256').update(entityId).digest('hex').slice(0, 2);

    expect(paths.aggregate('courses', entityId)).toBe(
      path.join(root.absolutePath, 'entities', 'courses', shard, `${entityId}.json`),
    );
  });

  it('declares every directory required by the version-one store layout', () => {
    const root = DataRoot.create(path.resolve('test-data'));
    const paths = createStorePaths(root);
    const relative = paths
      .requiredDirectories()
      .map((directory) => path.relative(root.absolutePath, directory));

    expect(relative).toEqual(
      expect.arrayContaining([
        'locks',
        path.join('transactions', 'prepared'),
        path.join('transactions', 'committed'),
        'idempotency',
        path.join('events', 'segments'),
        path.join('outbox', 'pending'),
        path.join('outbox', 'receipts'),
        path.join('tasks', 'queued'),
        path.join('tasks', 'active'),
        path.join('tasks', 'terminal'),
        path.join('tasks', 'journals'),
        'indexes',
        'read-models',
        path.join('global-profile', 'fact-metrics'),
        path.join('global-profile', 'time-series'),
        path.join('global-profile', 'artifact-index'),
        path.join('global-profile', 'cursors'),
        'portrait-evidence',
        'portraits',
        'work',
        'quarantine',
      ]),
    );
  });

  it('creates the complete store directory layout', async () => {
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'learning-more-paths-'));
    try {
      const paths = createStorePaths(DataRoot.create(temporaryRoot));

      await initializeStoreLayout(paths);

      await expect(
        Promise.all(paths.requiredDirectories().map((directory) => stat(directory))),
      ).resolves.toHaveLength(paths.requiredDirectories().length);
    } finally {
      await rm(temporaryRoot, { force: true, recursive: true });
    }
  });
});
