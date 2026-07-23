import {
  CalendarResponseSchema,
  CatalogIndexResponseSchema,
  ScheduleViewResponseSchema,
  StatisticsResponseSchema,
  WeeklyReportResponseSchema,
  type CalendarResponse,
  type CatalogIndexView,
  type ScheduleItemView,
  type StatisticsResponse,
  type WeeklyReportResponse,
} from '@learning-more/contracts';

import { apiRequestConditional } from '../client/api-client.js';
import { QuerySnapshotCache } from './query-snapshot-cache.js';

function createCache<T>(
  input: Readonly<{
    key: string;
    url: string;
    schema: Readonly<{ parse(value: unknown): T }>;
  }>,
): QuerySnapshotCache<T> {
  return new QuerySnapshotCache({
    key: input.key,
    contractVersion: 1,
    async load(etag, signal) {
      const result = await apiRequestConditional(input.url, {
        schema: input.schema,
        ...(etag === undefined ? {} : { etag }),
        ...(signal === undefined ? {} : { signal }),
      });
      return result.status === 'unchanged'
        ? { status: 'unchanged', ...(result.etag === undefined ? {} : { etag: result.etag }) }
        : {
            status: 'updated',
            data: result.data,
            ...(result.etag === undefined ? {} : { etag: result.etag }),
          };
    },
  });
}

export const catalogIndexCache = createCache<CatalogIndexView>({
  key: 'catalog-index',
  url: '/api/v1/catalog-index',
  schema: CatalogIndexResponseSchema,
});

export const planningContextCache = createCache<CatalogIndexView>({
  key: 'planning-context',
  url: '/api/v1/planning-context',
  schema: CatalogIndexResponseSchema,
});

type ScheduleSnapshot = Readonly<{
  items: readonly ScheduleItemView[];
  resourceVersion: number;
}>;

export const scheduleSnapshotCache = createCache<ScheduleSnapshot>({
  key: 'schedule',
  url: '/api/v1/schedule',
  schema: ScheduleViewResponseSchema,
});

export const statisticsSnapshotCache = createCache<StatisticsResponse>({
  key: 'history-statistics-v2',
  url: '/api/v1/history/stats',
  schema: StatisticsResponseSchema,
});

const calendarCaches = new Map<string, QuerySnapshotCache<CalendarResponse>>();

export function calendarSnapshotCache(year: string): QuerySnapshotCache<CalendarResponse> {
  let cache = calendarCaches.get(year);
  if (cache === undefined) {
    cache = createCache({
      key: `history-calendar-v2:${year}`,
      url: `/api/v1/history/calendar?from=${year}-01-01&to=${year}-12-31`,
      schema: CalendarResponseSchema,
    });
    calendarCaches.set(year, cache);
  }
  return cache;
}

type WeeklyReportSnapshot = Readonly<{ report?: WeeklyReportResponse }>;
const weeklyReportCaches = new Map<string, QuerySnapshotCache<WeeklyReportSnapshot>>();

export function weeklyReportSnapshotCache(key: string): QuerySnapshotCache<WeeklyReportSnapshot> {
  let cache = weeklyReportCaches.get(key);
  if (cache === undefined) {
    cache = new QuerySnapshotCache<WeeklyReportSnapshot>({
      key: `weekly-report:${key}`,
      contractVersion: 1,
      async load(etag, signal) {
        const response = await fetch(`/api/v1/weekly-reports/${encodeURIComponent(key)}`, {
          headers: {
            accept: 'application/json',
            ...(etag === undefined ? {} : { 'if-none-match': etag }),
          },
          ...(signal === undefined ? {} : { signal }),
        });
        const nextEtag = response.headers.get('etag') ?? undefined;
        if (response.status === 304) {
          return {
            status: 'unchanged' as const,
            ...(nextEtag === undefined ? {} : { etag: nextEtag }),
          };
        }
        if (response.status === 404) return { status: 'updated' as const, data: {} };
        const value: unknown = await response.json().catch(() => undefined);
        if (!response.ok) throw new Error(`Unexpected HTTP ${response.status}`);
        return {
          status: 'updated' as const,
          data: { report: WeeklyReportResponseSchema.parse(value) },
          ...(nextEtag === undefined ? {} : { etag: nextEtag }),
        };
      },
    });
    weeklyReportCaches.set(key, cache);
  }
  return cache;
}
