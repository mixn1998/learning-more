export type HistoryEntry = Readonly<{
  factId: string;
  factType: string;
  occurredAt: string;
  subjectRefs: Readonly<Record<string, string>>;
  payload: Readonly<Record<string, unknown>>;
}>;

export type ProjectionStatus = Readonly<{
  asOfEventId?: string;
  projectionVersion: number;
  freshness: 'current' | 'stale' | 'rebuilding';
}>;

export interface HistoryClient {
  getHistory(cursor?: string): Promise<
    ProjectionStatus & {
      entries: readonly HistoryEntry[];
      nextCursor?: string;
    }
  >;
  getStatistics(): Promise<ProjectionStatus & Record<string, unknown>>;
  getCalendar(
    from: string,
    to: string,
  ): Promise<
    ProjectionStatus & {
      days: readonly Readonly<{
        localDate: string;
        actualSeconds: number;
        completedLessonIds: readonly string[];
      }>[];
    }
  >;
  getWeekly(isoWeek: string): Promise<ProjectionStatus & { week?: Record<string, unknown> }>;
  getWeeklyReport(localWeekKey: string): Promise<Record<string, unknown> | undefined>;
}

async function request<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (response.status === 404 || response.status === 503) return undefined as T;
  const body = (await response.json()) as T;
  if (!response.ok) throw body;
  return body;
}

export const historyClient: HistoryClient = {
  getHistory: (cursor) =>
    request(
      `/api/v1/history?pageSize=50${cursor === undefined ? '' : `&cursor=${encodeURIComponent(cursor)}`}`,
    ),
  getStatistics: () => request('/api/v1/history/stats'),
  getCalendar: (from, to) =>
    request(
      `/api/v1/history/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    ),
  getWeekly: (isoWeek) => request(`/api/v1/history/weeks/${encodeURIComponent(isoWeek)}`),
  getWeeklyReport: (key) => request(`/api/v1/weekly-reports/${encodeURIComponent(key)}`),
};
