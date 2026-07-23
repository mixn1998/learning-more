import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { LearningEventEnvelope } from '@learning-more/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  TransactionContext,
  TransactionRequest,
  UnitOfWork,
} from '../../persistence/unit-of-work.js';
import { createLocalFoundation } from './foundation.js';
import { createLocalEventFactsRuntime } from './event-facts-runtime.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

function courseCreated(id: string): LearningEventEnvelope {
  return {
    id,
    schema_version: 1,
    type: 'CourseCreated',
    occurred_at: '2026-07-18T00:00:00.000Z',
    recorded_at: '2026-07-18T00:00:00.000Z',
    source: 'course-authoring',
    target_refs: { courseId: `course_${id}` },
    payload: { title: 'Course' },
    idempotency_key: id,
    correlation_id: id,
  };
}

function courseArchived(id: string, courseId: string): LearningEventEnvelope {
  return {
    id,
    schema_version: 1,
    type: 'CourseArchiveDeleted',
    occurred_at: '2026-07-18T00:01:00.000Z',
    recorded_at: '2026-07-18T00:01:00.000Z',
    source: 'course-authoring',
    target_refs: { courseId },
    payload: { deletedCounts: { courses: 1, lessons: 0, facts: 1, evidence: 0 } },
    idempotency_key: id,
    correlation_id: id,
  };
}

describe('local event facts runtime snapshots', () => {
  it('does not replay event transactions whose facts are already durable', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'learning-more-fact-recovery-'));
    roots.push(directory);
    const foundation = await createLocalFoundation({ dataRoot: directory, csrfToken: 'test' });
    const first = await createLocalEventFactsRuntime({
      dataRoot: foundation.dataRoot,
      unitOfWork: foundation.unitOfWork,
    });
    await foundation.unitOfWork.execute({ transactionId: 'tx_seed_course' }, (tx) =>
      first.outbox.enqueue(tx, [courseCreated('event_seed')]),
    );
    await first.flush();

    const execute = vi.fn();
    const unitOfWork: UnitOfWork = {
      execute<T>(
        request: TransactionRequest,
        work: (tx: TransactionContext) => Promise<T>,
      ): Promise<T> {
        execute(request);
        return foundation.unitOfWork.execute(request, work);
      },
    };
    await createLocalEventFactsRuntime({
      dataRoot: foundation.dataRoot,
      unitOfWork,
    });

    expect(execute).not.toHaveBeenCalled();
  });

  it('reuses and incrementally updates one fact snapshot across read models', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'learning-more-fact-cache-'));
    roots.push(directory);
    const foundation = await createLocalFoundation({ dataRoot: directory, csrfToken: 'test' });
    const runtime = await createLocalEventFactsRuntime({
      dataRoot: foundation.dataRoot,
      unitOfWork: foundation.unitOfWork,
    });
    const list = vi.spyOn(runtime.factRepository, 'list');

    await runtime.historyView();
    await runtime.statisticsView();
    await runtime.calendarView();

    expect(list).not.toHaveBeenCalled();

    await foundation.unitOfWork.execute({ transactionId: 'tx_enqueue_course' }, (tx) =>
      runtime.outbox.enqueue(tx, [courseCreated('event_01')]),
    );
    const history = await runtime.historyView();

    expect(list).not.toHaveBeenCalled();
    expect(history.entries).toHaveLength(1);

    await foundation.unitOfWork.execute({ transactionId: 'tx_archive_course' }, (tx) =>
      runtime.outbox.enqueue(tx, [courseArchived('event_archive_01', 'course_event_01')]),
    );
    await runtime.flush();
    list.mockClear();
    const archivedHistory = await runtime.historyView();

    expect(list).not.toHaveBeenCalled();
    expect(archivedHistory.entries).toHaveLength(0);
  });
});
