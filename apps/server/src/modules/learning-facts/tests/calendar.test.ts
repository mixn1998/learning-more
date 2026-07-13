import { describe, expect, it } from 'vitest';

import {
  createCalendarProjection,
  selectCalendarMonth,
} from '../implementation/projections/calendar.js';
import type { LearningFact } from '../interface.js';

function completion(factId: string, occurredAt: string, lessonId: string): LearningFact {
  return {
    factId,
    factType: 'LessonCompletedFact',
    sourceEventId: `event_${factId}`,
    occurredAt,
    subjectRefs: { lessonId },
    recordedAt: occurredAt,
    dataKeys: [],
    payload: { actualSeconds: 60 },
    schemaVersion: 1,
  };
}

describe('calendar projection', () => {
  it('[EQ-CAL-01] aggregates by local date and switches months without leaking other days', () => {
    const projection = createCalendarProjection('Asia/Shanghai');
    projection.apply([completion('one', '2026-06-30T16:30:00.000Z', 'lesson_july')]);
    projection.apply([completion('two', '2026-07-31T16:30:00.000Z', 'lesson_august')]);

    expect(selectCalendarMonth(projection.view(), '2026-07').days).toEqual([
      expect.objectContaining({ localDate: '2026-07-01', completedLessonIds: ['lesson_july'] }),
    ]);
    expect(selectCalendarMonth(projection.view(), '2026-08').days).toEqual([
      expect.objectContaining({ localDate: '2026-08-01', completedLessonIds: ['lesson_august'] }),
    ]);
  });
});
