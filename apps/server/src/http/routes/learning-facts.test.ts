import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import { WeeklyResponseSchema } from '@learning-more/contracts';

import { registerLearningFactsRoutes } from './learning-facts.js';

const entries = [
  {
    factId: 'f1',
    factType: 'LessonCompletedFact',
    occurredAt: '2026-07-01T00:00:00.000Z',
    subjectRefs: {},
    payload: {},
  },
  {
    factId: 'f2',
    factType: 'LessonCompletedFact',
    occurredAt: '2026-07-01T00:00:00.000Z',
    subjectRefs: {},
    payload: {},
  },
  {
    factId: 'f3',
    factType: 'CourseClosedFact',
    occurredAt: '2026-07-02T00:00:00.000Z',
    subjectRefs: {},
    payload: {},
  },
];

function fixture(
  overrides: Record<string, unknown> = {},
  getLessonActualInterval?: (
    lessonId: string,
  ) => Promise<Readonly<{ actualStartedAt: string; actualEndedAt: string }> | undefined>,
) {
  const commands = {
    retryWeeklyReport: vi.fn(),
  };
  const queries = {
    getHistory: vi.fn().mockResolvedValue({
      entries,
      asOfEventId: 'event_f3',
      projectionVersion: 1,
      freshness: 'current',
    }),
    getCourseSummary: vi.fn().mockResolvedValue({
      courses: [],
      asOfEventId: 'event_f3',
      projectionVersion: 1,
      freshness: 'current',
    }),
    getStatistics: vi.fn().mockResolvedValue({
      totalActualSeconds: 0,
      asOfEventId: 'event_f3',
      projectionVersion: 1,
      freshness: 'current',
    }),
    getCalendar: vi.fn().mockResolvedValue({
      days: [],
      asOfEventId: 'event_f3',
      projectionVersion: 1,
      freshness: 'current',
    }),
    getWeekly: vi.fn().mockResolvedValue({
      weeks: [],
      asOfEventId: 'event_f3',
      projectionVersion: 1,
      freshness: 'current',
    }),
    getWeeklyReport: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  const app = Fastify();
  void registerLearningFactsRoutes(app, {
    commands,
    nextCommandId: () => 'command_weekly_retry',
    nextCorrelationId: () => 'correlation_weekly_retry',
    now: () => new Date('2026-07-27T03:00:00.000Z'),
    queries,
    ...(getLessonActualInterval === undefined ? {} : { getLessonActualInterval }),
  });
  return { app, commands, queries };
}

describe('LearningFacts HTTP routes', () => {
  it('accepts an explicit retry for a failed weekly report with version control', async () => {
    const { app, commands } = fixture();
    vi.mocked(commands.retryWeeklyReport).mockResolvedValue({
      localWeekKey: '2026-W30',
      timezone: 'Asia/Shanghai',
      startLocalDate: '2026-07-20',
      endLocalDate: '2026-07-27',
      state: 'generating',
      factSnapshot: [],
      factSnapshotHash: 'snapshot_hash',
      snapshotExclusions: [],
      metricDefinitionVersion: 4,
      generationTaskId: 'task_retry_01',
      attemptCount: 2,
      createdAt: '2026-07-27T02:00:00.000Z',
      updatedAt: '2026-07-27T03:00:00.000Z',
      resourceVersion: 4,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/weekly-reports/2026-W30/retries',
      headers: {
        'idempotency-key': 'retry_weekly_report_01',
        'if-match': '"3"',
        'x-page-instance-id': 'history_page_01',
      },
      payload: {},
    });

    expect(response.statusCode).toBe(202);
    expect(response.headers.etag).toBe('"4"');
    expect(commands.retryWeeklyReport).toHaveBeenCalledWith(
      '2026-W30',
      expect.objectContaining({
        commandId: 'command_weekly_retry',
        correlationId: 'correlation_weekly_retry',
        expectedVersion: 3,
      }),
    );
  });

  it('uses a stable sort-key cursor without duplicates or omissions', async () => {
    const { app } = fixture();
    const first = await app.inject({ method: 'GET', url: '/api/v1/history?pageSize=2' });
    expect(first.statusCode).toBe(200);
    expect(first.headers.etag).toBe('"event_f3:1"');
    const firstBody = first.json<{ entries: typeof entries; nextCursor: string }>();
    expect(firstBody.entries.map((entry) => entry.factId)).toEqual(['f1', 'f2']);
    const second = await app.inject({
      method: 'GET',
      url: `/api/v1/history?pageSize=2&cursor=${encodeURIComponent(firstBody.nextCursor)}`,
    });
    expect(second.json<{ entries: typeof entries }>().entries.map((entry) => entry.factId)).toEqual(
      ['f3'],
    );
  });

  it('validates calendar ranges and caps them at 366 days', async () => {
    const { app } = fixture();
    for (const url of [
      '/api/v1/history/calendar?from=2026-07-02&to=2026-07-01',
      '/api/v1/history/calendar?from=2025-01-01&to=2026-07-01',
      '/api/v1/history?pageSize=101',
    ]) {
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(400);
    }
  });

  it('enriches completed calendar lessons with the full actual study interval', async () => {
    const getLessonActualInterval = vi.fn().mockResolvedValue({
      actualStartedAt: '2026-07-20T08:10:00.000Z',
      actualEndedAt: '2026-07-20T09:25:00.000Z',
    });
    const { app } = fixture(
      {
        getCalendar: vi.fn().mockResolvedValue({
          days: [
            {
              localDate: '2026-07-20',
              actualSeconds: 3_600,
              completedLessonIds: ['lesson_1'],
              completions: [{ lessonId: 'lesson_1', courseId: 'course_1', actualSeconds: 3_600 }],
            },
          ],
          asOfEventId: 'event_f3',
          projectionVersion: 1,
          freshness: 'current',
        }),
      },
      getLessonActualInterval,
    );

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/history/calendar?from=2026-07-20&to=2026-07-20',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().days[0].completions[0]).toMatchObject({
      lessonId: 'lesson_1',
      actualStartedAt: '2026-07-20T08:10:00.000Z',
      actualEndedAt: '2026-07-20T09:25:00.000Z',
    });
    expect(getLessonActualInterval).toHaveBeenCalledWith('lesson_1');
  });

  it('returns the selected week without leaking the projection collection', async () => {
    const { app } = fixture({
      getWeekly: vi.fn().mockResolvedValue({
        weeks: [
          {
            isoWeek: '2026-W29',
            timezone: 'Asia/Shanghai',
            actualSeconds: 600,
            completedLessonCount: 1,
            activeDayCount: 1,
          },
        ],
        asOfEventId: 'event_f3',
        projectionVersion: 1,
        freshness: 'current',
      }),
    });
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/history/weeks/2026-W29',
    });

    expect(response.statusCode).toBe(200);
    const body = WeeklyResponseSchema.parse(response.json());
    expect(body.week).toMatchObject({ isoWeek: '2026-W29', completedLessonCount: 1 });
    expect(response.json()).not.toHaveProperty('weeks');
  });

  it('returns stale snapshots with a header and missing snapshots as 503', async () => {
    const stale = fixture({
      getStatistics: vi.fn().mockResolvedValue({
        totalActualSeconds: 10,
        projectionVersion: 1,
        freshness: 'stale',
      }),
    });
    const staleResponse = await stale.app.inject({ method: 'GET', url: '/api/v1/history/stats' });
    expect(staleResponse.statusCode).toBe(200);
    expect(staleResponse.headers['x-projection-status']).toBe('stale');

    const missing = fixture({ getHistory: vi.fn().mockResolvedValue(undefined) });
    const missingResponse = await missing.app.inject({ method: 'GET', url: '/api/v1/history' });
    expect(missingResponse.statusCode).toBe(503);
    expect(missingResponse.json()).toMatchObject({ code: 'projection_incomplete' });
  });

  it('returns 304 without a projection body when the read model is unchanged', async () => {
    const { app, queries } = fixture();
    const first = await app.inject({ method: 'GET', url: '/api/v1/history/stats' });
    const second = await app.inject({
      method: 'GET',
      url: '/api/v1/history/stats',
      headers: { 'if-none-match': first.headers.etag! },
    });

    expect(second.statusCode).toBe(304);
    expect(second.body).toBe('');
    expect(queries.getStatistics).toHaveBeenCalledTimes(2);
  });
});
