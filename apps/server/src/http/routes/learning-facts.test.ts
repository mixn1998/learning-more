import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

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

function fixture(overrides: Record<string, unknown> = {}) {
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
  void registerLearningFactsRoutes(app, { queries });
  return { app, queries };
}

describe('LearningFacts HTTP routes', () => {
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
});
