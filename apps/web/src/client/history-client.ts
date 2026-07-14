import {
  CalendarResponseSchema,
  CourseSummaryResponseSchema,
  HistoryPageResponseSchema,
  HomeDashboardResponseSchema,
  StatisticsResponseSchema,
  WeeklyReportResponseSchema,
  WeeklyResponseSchema,
  type CalendarResponse,
  type CourseSummaryResponse,
  type HistoryPageResponse,
  type HomeDashboardView,
  type StatisticsResponse,
  type WeeklyReportResponse,
  type WeeklyResponse,
} from '@learning-more/contracts';

import { apiRequest, apiRequestOptional } from './api-client.js';

export type { HistoryEntry } from '@learning-more/contracts';

export interface HistoryClient {
  getDashboard(): Promise<HomeDashboardView>;
  getHistory(cursor?: string): Promise<HistoryPageResponse>;
  getStatistics(): Promise<StatisticsResponse>;
  getCalendar(from: string, to: string): Promise<CalendarResponse>;
  getCourseSummary(courseId: string): Promise<CourseSummaryResponse>;
  getWeekly(isoWeek: string): Promise<WeeklyResponse>;
  getWeeklyReport(localWeekKey: string): Promise<WeeklyReportResponse | undefined>;
}

export const historyClient: HistoryClient = {
  async getDashboard() {
    return (await apiRequest('/api/v1/home', { schema: HomeDashboardResponseSchema })).data;
  },
  async getHistory(cursor) {
    const suffix = cursor === undefined ? '' : `&cursor=${encodeURIComponent(cursor)}`;
    return (
      await apiRequest(`/api/v1/history?pageSize=50${suffix}`, {
        schema: HistoryPageResponseSchema,
      })
    ).data;
  },
  async getStatistics() {
    return (await apiRequest('/api/v1/history/stats', { schema: StatisticsResponseSchema })).data;
  },
  async getCalendar(from, to) {
    return (
      await apiRequest(
        `/api/v1/history/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        { schema: CalendarResponseSchema },
      )
    ).data;
  },
  async getCourseSummary(courseId) {
    return (
      await apiRequest(`/api/v1/courses/${encodeURIComponent(courseId)}/summary`, {
        schema: CourseSummaryResponseSchema,
      })
    ).data;
  },
  async getWeekly(isoWeek) {
    return (
      await apiRequest(`/api/v1/history/weeks/${encodeURIComponent(isoWeek)}`, {
        schema: WeeklyResponseSchema,
      })
    ).data;
  },
  async getWeeklyReport(localWeekKey) {
    return (
      await apiRequestOptional(`/api/v1/weekly-reports/${encodeURIComponent(localWeekKey)}`, {
        schema: WeeklyReportResponseSchema,
      })
    ).data;
  },
};
