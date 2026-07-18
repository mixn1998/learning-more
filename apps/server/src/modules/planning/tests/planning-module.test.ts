import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { createInMemoryScheduleRepository } from '../ports/schedule-repository.js';
import { createPlanningModule } from '../implementation/planning-module.js';

const tx = {
  stageJson: async () => undefined,
  stageText: async () => undefined,
  deleteOnCommit: async () => undefined,
};
const unitOfWork = {
  async execute<T>(_request: unknown, work: (context: typeof tx) => Promise<T>) {
    return work(tx);
  },
};

const baseContext = {
  correlationId: 'correlation_01',
  idempotencyKey: 'idem_01',
  actor: 'local-user' as const,
  requestedAt: '2026-07-13T00:00:00.000Z',
  receivedAt: '2026-07-13T00:00:00.000Z',
};

function fixture(
  completedLessonIds: readonly string[] = [],
  abandonedLessonIds: readonly string[] = [],
) {
  const repository = createInMemoryScheduleRepository();
  let id = 0;
  const events: string[] = [];
  const module = createPlanningModule({
    repository,
    unitOfWork,
    getLessonProgress: async (lessonId) =>
      completedLessonIds.includes(lessonId)
        ? 'completed'
        : abandonedLessonIds.includes(lessonId)
          ? 'abandoned'
          : 'not_started',
    nextScheduleItemId: () => `schedule_${++id}`,
    now: () => new Date('2026-07-13T00:00:00.000Z'),
    recordEvent: async (event) => {
      events.push(event.type);
    },
  });
  return { module, repository, events };
}

describe('PlanningModule', () => {
  it('rejects a stale planning write when the course archive disappeared before commit', async () => {
    const repository = createInMemoryScheduleRepository();
    let deleted = false;
    const module = createPlanningModule({
      repository,
      unitOfWork,
      getLessonProgress: async () => (deleted ? undefined : 'not_started'),
      nextScheduleItemId: () => 'schedule_late',
      now: () => new Date('2026-07-13T00:00:00.000Z'),
    });
    deleted = true;

    await expect(
      module.execute(
        {
          type: 'CreateScheduleItem',
          courseId: 'course_deleted',
          lessonId: 'lesson_deleted',
          startAt: '2026-07-13T01:00:00.000Z',
          endAt: '2026-07-13T02:00:00.000Z',
          timezoneAtCreation: 'Asia/Shanghai',
          source: 'manual',
        },
        { ...baseContext, commandId: 'late_plan' },
      ),
    ).rejects.toMatchObject({ code: 'lesson_not_plannable' });
    await expect(repository.get('schedule_late')).resolves.toBeUndefined();
  });

  it('validates intervals and refuses to schedule a completed or abandoned lesson', async () => {
    const { module } = fixture(['lesson_done'], ['lesson_abandoned']);
    await expect(
      module.execute(
        {
          type: 'CreateScheduleItem',
          courseId: 'course_01',
          lessonId: 'lesson_01',
          startAt: '2026-07-13T01:00:00.000Z',
          endAt: '2026-07-13T01:00:00.000Z',
          timezoneAtCreation: 'Asia/Shanghai',
          source: 'manual',
        },
        { ...baseContext, commandId: 'invalid' },
      ),
    ).rejects.toMatchObject({ code: 'schedule_interval_invalid' });
    await expect(
      module.execute(
        {
          type: 'CreateScheduleItem',
          courseId: 'course_01',
          lessonId: 'lesson_done',
          startAt: '2026-07-13T01:00:00.000Z',
          endAt: '2026-07-13T02:00:00.000Z',
          timezoneAtCreation: 'Asia/Shanghai',
          source: 'manual',
        },
        { ...baseContext, commandId: 'completed' },
      ),
    ).rejects.toMatchObject({ code: 'lesson_not_plannable' });
    await expect(
      module.execute(
        {
          type: 'CreateScheduleItem',
          courseId: 'course_01',
          lessonId: 'lesson_abandoned',
          startAt: '2026-07-13T01:00:00.000Z',
          endAt: '2026-07-13T02:00:00.000Z',
          timezoneAtCreation: 'Asia/Shanghai',
          source: 'manual',
        },
        { ...baseContext, commandId: 'abandoned' },
      ),
    ).rejects.toMatchObject({ code: 'lesson_not_plannable' });
  });

  it('deduplicates a create command and reports concrete same-lesson overlaps', async () => {
    const { module } = fixture();
    const command = {
      type: 'CreateScheduleItem' as const,
      courseId: 'course_01',
      lessonId: 'lesson_01',
      startAt: '2026-07-13T01:00:00.000Z',
      endAt: '2026-07-13T02:00:00.000Z',
      timezoneAtCreation: 'Asia/Shanghai',
      source: 'manual' as const,
    };
    const created = await module.execute(command, { ...baseContext, commandId: 'create_01' });
    await expect(
      module.execute(command, { ...baseContext, commandId: 'create_01' }),
    ).resolves.toEqual(created);
    await expect(
      module.execute(
        { ...command, startAt: '2026-07-13T01:30:00.000Z', endAt: '2026-07-13T02:30:00.000Z' },
        { ...baseContext, commandId: 'create_02' },
      ),
    ).rejects.toMatchObject({
      code: 'schedule_conflict',
      conflictingItemIds: [created.scheduleItem.id],
    });
  });

  it('moves, resizes, and removes without erasing schedule history', async () => {
    const { module, repository, events } = fixture();
    const created = await module.execute(
      {
        type: 'CreateScheduleItem',
        courseId: 'course_01',
        lessonId: 'lesson_01',
        startAt: '2026-07-13T01:00:00.000Z',
        endAt: '2026-07-13T02:00:00.000Z',
        timezoneAtCreation: 'America/New_York',
        source: 'manual',
      },
      { ...baseContext, commandId: 'create' },
    );
    const moved = await module.execute(
      {
        type: 'MoveScheduleItem',
        scheduleItemId: created.scheduleItem.id,
        startAt: '2026-07-14T03:30:00.000Z',
        endAt: '2026-07-14T05:00:00.000Z',
      },
      { ...baseContext, commandId: 'move', expectedVersion: 1 },
    );
    expect(Date.parse(moved.scheduleItem.endAt) - Date.parse(moved.scheduleItem.startAt)).toBe(
      90 * 60 * 1000,
    );
    const resized = await module.execute(
      {
        type: 'ResizeScheduleItem',
        scheduleItemId: created.scheduleItem.id,
        endAt: '2026-07-14T05:30:00.000Z',
      },
      { ...baseContext, commandId: 'resize', expectedVersion: 2 },
    );
    expect(resized.scheduleItem.timezoneAtCreation).toBe('America/New_York');
    const locked = await module.execute(
      { type: 'SetScheduleLock', scheduleItemId: created.scheduleItem.id, locked: true },
      { ...baseContext, commandId: 'lock', expectedVersion: 3 },
    );
    expect(locked.scheduleItem.locked).toBe(true);
    await module.execute(
      { type: 'RemoveScheduleItem', scheduleItemId: created.scheduleItem.id },
      { ...baseContext, commandId: 'remove', expectedVersion: 4 },
    );
    await expect(repository.get(created.scheduleItem.id)).resolves.toMatchObject({
      status: 'removed',
      resourceVersion: 5,
    });
    expect(events).toEqual([
      'SchedulePlanned',
      'ScheduleChanged',
      'ScheduleChanged',
      'ScheduleChanged',
      'ScheduleCancelled',
    ]);
  });

  it('clears every active schedule atomically while preserving removed records', async () => {
    const { module, repository, events } = fixture();
    for (const lessonId of ['lesson_01', 'lesson_02']) {
      await module.execute(
        {
          type: 'CreateScheduleItem',
          courseId: 'course_01',
          lessonId,
          startAt: `2026-07-${lessonId === 'lesson_01' ? '13' : '14'}T01:00:00.000Z`,
          endAt: `2026-07-${lessonId === 'lesson_01' ? '13' : '14'}T02:00:00.000Z`,
          timezoneAtCreation: 'Asia/Shanghai',
          source: 'manual',
        },
        { ...baseContext, commandId: `create_${lessonId}` },
      );
    }

    const cleared = await module.clearAll({
      ...baseContext,
      commandId: 'clear_all',
      expectedVersion: 2,
    });

    expect(cleared.removedItems).toHaveLength(2);
    await expect(module.list()).resolves.toEqual([]);
    await expect(repository.get('schedule_1')).resolves.toMatchObject({
      status: 'removed',
      cancelReason: 'user_cleared_all',
      resourceVersion: 2,
    });
    await expect(repository.get('schedule_2')).resolves.toMatchObject({
      status: 'removed',
      cancelReason: 'user_cleared_all',
      resourceVersion: 2,
    });
    expect(events).toEqual([
      'SchedulePlanned',
      'SchedulePlanned',
      'ScheduleCancelled',
      'ScheduleCancelled',
    ]);
  });

  it('round-trips UTC intervals and sorts deterministically over 2,000 generated cases', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            start: fc.integer({ min: 0, max: 4_000_000_000 }),
            duration: fc.integer({ min: 1, max: 86_400_000 }),
            id: fc.uuid(),
          }),
          { maxLength: 30 },
        ),
        (items) => {
          const normalized = items.map((item) => ({
            id: item.id,
            startAt: new Date(Date.UTC(2026, 0, 1) + item.start).toISOString(),
            endAt: new Date(Date.UTC(2026, 0, 1) + item.start + item.duration).toISOString(),
          }));
          const sorted = [...normalized].sort((left, right) =>
            left.startAt === right.startAt
              ? left.id.localeCompare(right.id)
              : left.startAt.localeCompare(right.startAt),
          );
          expect(
            [...sorted].sort((left, right) =>
              left.startAt === right.startAt
                ? left.id.localeCompare(right.id)
                : left.startAt.localeCompare(right.startAt),
            ),
          ).toEqual(sorted);
          for (const item of normalized) {
            expect(new Date(item.startAt).toISOString()).toBe(item.startAt);
            expect(Date.parse(item.endAt)).toBeGreaterThan(Date.parse(item.startAt));
          }
        },
      ),
      { numRuns: 2_000 },
    );
  });
});
