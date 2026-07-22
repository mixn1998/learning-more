import { describe, expect, it } from 'vitest';

import { CalendarResponseSchema } from './learning-facts-http.js';

describe('calendar HTTP contract', () => {
  it('accepts actual study interval enrichment on completed lessons', () => {
    const response = CalendarResponseSchema.parse({
      asOfEventId: 'event_1',
      projectionVersion: 1,
      freshness: 'current',
      days: [
        {
          localDate: '2026-07-22',
          actualSeconds: 600,
          completedLessonIds: ['lesson_1'],
          completions: [
            {
              lessonId: 'lesson_1',
              courseId: 'course_1',
              actualSeconds: 600,
              actualStartedAt: '2026-07-22T08:10:00.000Z',
              actualEndedAt: '2026-07-22T08:20:00.000Z',
            },
          ],
        },
      ],
    });

    expect(response.days[0]?.completions[0]).toMatchObject({
      actualStartedAt: '2026-07-22T08:10:00.000Z',
      actualEndedAt: '2026-07-22T08:20:00.000Z',
    });
  });
});
