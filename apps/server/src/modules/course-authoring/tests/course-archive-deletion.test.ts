import type { CommandContext, LearningEventEnvelope } from '@learning-more/contracts';
import { describe, expect, it, vi } from 'vitest';

import type { Outbox } from '../../../persistence/outbox.js';
import type { TransactionContext, UnitOfWork } from '../../../persistence/unit-of-work.js';
import { createCourseArchiveDeletion } from '../implementation/course-archive-deletion.js';
import type {
  CourseArchiveDeletionReceipt,
  CourseArchiveStore,
} from '../ports/course-archive-store.js';

const tx: TransactionContext = {
  stageJson: async () => undefined,
  stageText: async () => undefined,
  deleteOnCommit: async () => undefined,
};

const unitOfWork: UnitOfWork = {
  async execute(_request, work) {
    return work(tx);
  },
};

const context: CommandContext = {
  commandId: 'command_delete_01',
  correlationId: 'correlation_delete_01',
  idempotencyKey: 'delete-course-01',
  actor: 'local-user',
  requestedAt: '2026-07-13T08:00:00.000Z',
  receivedAt: '2026-07-13T08:00:00.000Z',
  expectedVersion: 4,
};

describe('CourseArchiveDeletion public command seam', () => {
  it('atomically records the cascade and event, then replays the same result without a second refresh', async () => {
    const receipts = new Map<string, CourseArchiveDeletionReceipt>();
    let deleted = false;
    const stageDelete = vi.fn(async () => {
      deleted = true;
      return {
        courseId: 'course_01',
        deletedCounts: { courses: 1, lessons: 2, facts: 5, evidence: 3 },
      };
    });
    const store: CourseArchiveStore = {
      getCourse: async (courseId) =>
        deleted || courseId !== 'course_01' ? undefined : { courseId, resourceVersion: 4 },
      getReceipt: async (key) => receipts.get(key),
      stageDelete,
      async saveReceipt(_tx, receipt) {
        receipts.set(receipt.idempotencyKey, structuredClone(receipt));
      },
    };
    const events: LearningEventEnvelope[] = [];
    const outbox: Outbox = {
      async enqueue(_tx, batch) {
        events.push(...batch);
      },
      dispatchPending: async () => 0,
    };
    const deletion = createCourseArchiveDeletion({
      store,
      unitOfWork,
      outbox,
      nextEventId: () => 'event_delete_01',
      now: () => new Date('2026-07-13T08:01:00.000Z'),
    });

    const first = await deletion.execute({ courseId: 'course_01' }, context);
    const replayed = await deletion.execute({ courseId: 'course_01' }, context);

    expect(replayed).toEqual(first);
    expect(first).toEqual({
      commandId: 'command_delete_01',
      outcome: 'completed',
      value: {
        kind: 'course-archive-deleted',
        courseId: 'course_01',
        deletedAt: '2026-07-13T08:01:00.000Z',
      },
    });
    expect(stageDelete).toHaveBeenCalledTimes(1);
    expect(events).toEqual([
      expect.objectContaining({
        id: 'event_delete_01',
        type: 'CourseArchiveDeleted',
        target_refs: { courseId: 'course_01' },
        payload: {
          deletedCounts: { courses: 1, lessons: 2, facts: 5, evidence: 3 },
        },
      }),
    ]);
  });
});
