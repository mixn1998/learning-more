import { describe, expect, it, vi } from 'vitest';

import type { ScheduleItem } from '../model/schedule-item.js';
import type { ScheduleRepository } from '../ports/schedule-repository.js';
import { createScheduleIndex } from '../implementation/schedule-index.js';

function schedule(
  id: string,
  lessonId: string,
  resourceVersion: number,
  processedCommandIds: readonly string[] = [],
): ScheduleItem {
  return {
    id,
    courseId: 'course_01',
    lessonId,
    startAt: '2026-07-24T11:00:00.000Z',
    endAt: '2026-07-24T11:45:00.000Z',
    timezoneAtCreation: 'Asia/Shanghai',
    source: 'manual',
    status: 'scheduled',
    locked: false,
    createdAt: '2026-07-24T00:00:00.000Z',
    updatedAt: '2026-07-24T00:00:00.000Z',
    processedCommandIds,
    resourceVersion,
  };
}

describe('schedule index', () => {
  it('scans once per schedule revision and serves indexed lookups without rescanning', async () => {
    let revision = 'schedule:1';
    let items = [
      schedule('schedule_01', 'lesson_01', 2, ['command_01']),
      schedule('schedule_02', 'lesson_01', 3),
    ];
    const list = vi.fn<ScheduleRepository['list']>(async function* () {
      yield* items;
    });
    const repository: ScheduleRepository = {
      get: async (id) => items.find((item) => item.id === id),
      save: async () => undefined,
      list,
    };
    const index = createScheduleIndex({ repository, revision: () => revision });

    const first = await index.current();
    expect(first.get('schedule_01')?.lessonId).toBe('lesson_01');
    expect(first.forLesson('lesson_01')).toHaveLength(2);
    expect(first.forCommand('command_01')[0]?.id).toBe('schedule_01');
    expect(first.resourceVersion).toBe(5);
    expect((await index.current()).scheduled).toHaveLength(2);
    expect(list).toHaveBeenCalledTimes(1);

    items = [...items, schedule('schedule_03', 'lesson_02', 1)];
    revision = 'schedule:2';

    const rebuilt = await index.current();
    expect(rebuilt.get('schedule_03')?.lessonId).toBe('lesson_02');
    expect(rebuilt.resourceVersion).toBe(6);
    expect(list).toHaveBeenCalledTimes(2);
  });
});
