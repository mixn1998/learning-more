import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { LearningEventEnvelope } from '@learning-more/contracts';

import { DataRoot } from '../data-root.js';
import { createStorePaths, initializeStoreLayout } from '../paths.js';
import { createUnitOfWork } from '../unit-of-work.js';
import type { Projection } from './projection.js';
import { createProjectionRunner } from './projection-runner.js';
import { rebuildProjection } from './rebuild.js';

interface CountState {
  readonly count: number;
  readonly ids: readonly string[];
}

function projection(schemaVersion = 1): Projection<CountState> {
  return {
    name: 'course-count',
    schemaVersion,
    initial: () => ({ count: 0, ids: [] }),
    apply(state, event) {
      return { count: state.count + 1, ids: [...state.ids, event.id] };
    },
  };
}

function events(count: number): LearningEventEnvelope[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `event_${String(index).padStart(3, '0')}`,
    schema_version: 1,
    type: 'CourseCreated',
    occurred_at: '2026-07-13T00:00:00.000Z',
    recorded_at: '2026-07-13T00:00:00.000Z',
    source: 'course-authoring',
    target_refs: { courseId: `course_${index}` },
    payload: { index },
    idempotency_key: `create_${index}`,
    correlation_id: 'correlation_01',
  }));
}

const temporaryRoots: string[] = [];

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'learning-more-projection-'));
  temporaryRoots.push(directory);
  const dataRoot = DataRoot.create(directory);
  await initializeStoreLayout(createStorePaths(dataRoot));
  return { dataRoot, unitOfWork: createUnitOfWork({ dataRoot }) };
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe('projection rebuild', () => {
  it('produces byte-identical state and checksum for batch sizes 1, 7, and 100', async () => {
    const outputs = [];
    for (const batchSize of [1, 7, 100]) {
      const { dataRoot, unitOfWork } = await fixture();
      outputs.push(
        await rebuildProjection({
          dataRoot,
          unitOfWork,
          projection: projection(),
          events: events(23),
          batchSize,
        }),
      );
    }

    expect(new Set(outputs.map((output) => output.stateJson))).toHaveLength(1);
    expect(new Set(outputs.map((output) => output.stateChecksum))).toHaveLength(1);
  }, 45_000);

  it('does not apply a duplicate event id twice', async () => {
    const { dataRoot, unitOfWork } = await fixture();
    const source = events(3);

    const output = await rebuildProjection({
      dataRoot,
      unitOfWork,
      projection: projection(),
      events: [source[0]!, source[1]!, source[1]!, source[2]!],
      batchSize: 1,
    });

    expect(output.state).toEqual({ count: 3, ids: ['event_000', 'event_001', 'event_002'] });
  });

  it('resumes after a committed batch without repeating its events', async () => {
    const { dataRoot, unitOfWork } = await fixture();
    const runner = createProjectionRunner({ dataRoot, unitOfWork });

    await expect(
      runner.run({
        projection: projection(),
        events: events(5),
        batchSize: 2,
        generation: 'incremental-v1',
        faultInjector(point) {
          if (point === 'after-batch:0') throw new Error('SIMULATED_PROJECTION_CRASH');
        },
      }),
    ).rejects.toThrow('SIMULATED_PROJECTION_CRASH');

    const resumed = await runner.run({
      projection: projection(),
      events: events(5),
      batchSize: 2,
      generation: 'incremental-v1',
    });

    expect(resumed.state).toEqual({
      count: 5,
      ids: ['event_000', 'event_001', 'event_002', 'event_003', 'event_004'],
    });
  });

  it('creates and activates a new generation when schemaVersion changes', async () => {
    const { dataRoot, unitOfWork } = await fixture();
    const first = await rebuildProjection({
      dataRoot,
      unitOfWork,
      projection: projection(1),
      events: events(1),
      batchSize: 10,
    });
    const second = await rebuildProjection({
      dataRoot,
      unitOfWork,
      projection: projection(2),
      events: events(1),
      batchSize: 10,
    });

    expect(first.generation).not.toBe(second.generation);
    expect(second.generation).toContain('v2');
  });
});
