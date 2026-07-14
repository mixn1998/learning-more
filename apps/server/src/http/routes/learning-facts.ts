import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';

import { CalendarQuerySchema, HistoryQuerySchema, IsoWeekSchema } from '@learning-more/contracts';

import type { CalendarView } from '../../modules/learning-facts/implementation/projections/calendar.js';
import type { CourseSummaryView } from '../../modules/learning-facts/implementation/projections/course-summary.js';
import type { HistoryView } from '../../modules/learning-facts/implementation/projections/history.js';
import type { StatisticsView } from '../../modules/learning-facts/implementation/projections/statistics.js';
import type { WeeklyView } from '../../modules/learning-facts/implementation/projections/weekly.js';
import type { WeeklyReportRecord } from '../../modules/learning-facts/ports/weekly-report-repository.js';
import type { ReadModelStatus } from '../../modules/learning-facts/interface.js';
import { HttpContractError } from '../command-context.js';
import { mapApplicationError } from '../error-mapper.js';

export type LearningFactsRouteOptions = Readonly<{
  queries: {
    getHistory(): Promise<HistoryView | undefined>;
    getCourseSummary(): Promise<CourseSummaryView | undefined>;
    getStatistics(): Promise<StatisticsView | undefined>;
    getCalendar(): Promise<CalendarView | undefined>;
    getWeekly(): Promise<WeeklyView | undefined>;
    getWeeklyReport(localWeekKey: string): Promise<WeeklyReportRecord | undefined>;
  };
}>;

const CursorSchema = z.strictObject({
  occurredAt: z.iso.datetime({ offset: true }),
  factId: z.string().min(1),
});

function projectionError(): Error & { code: string } {
  return Object.assign(new Error('projection_incomplete'), { code: 'projection_incomplete' });
}

function notFound(): Error & { code: string } {
  return Object.assign(new Error('resource_not_found'), { code: 'resource_not_found' });
}

function requireSnapshot<T>(view: T | undefined): T {
  if (view === undefined) throw projectionError();
  return view;
}

function encodeCursor(value: z.infer<typeof CursorSchema>): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decodeCursor(value: string): z.infer<typeof CursorSchema> {
  return CursorSchema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
}

function compareEntry(
  left: { occurredAt: string; factId: string },
  right: { occurredAt: string; factId: string },
): number {
  return left.occurredAt === right.occurredAt
    ? left.factId.localeCompare(right.factId)
    : left.occurredAt.localeCompare(right.occurredAt);
}

function sendProjection<T extends ReadModelStatus & object>(reply: FastifyReply, view: T) {
  const etag = `${view.asOfEventId ?? 'empty'}:${view.projectionVersion}`;
  return reply
    .header('etag', `"${etag}"`)
    .header('x-projection-status', view.freshness)
    .code(200)
    .send(view);
}

export async function registerLearningFactsRoutes(
  app: FastifyInstance,
  options: LearningFactsRouteOptions,
): Promise<void> {
  app.get('/api/v1/history', async (request, reply) => {
    try {
      const query = HistoryQuerySchema.parse(request.query);
      const view = requireSnapshot(await options.queries.getHistory());
      const sorted = [...view.entries].sort(compareEntry);
      const cursor = query.cursor === undefined ? undefined : decodeCursor(query.cursor);
      const remaining =
        cursor === undefined ? sorted : sorted.filter((entry) => compareEntry(entry, cursor) > 0);
      const entries = remaining.slice(0, query.pageSize);
      const last = entries.at(-1);
      const nextCursor =
        remaining.length > entries.length && last !== undefined
          ? encodeCursor({ occurredAt: last.occurredAt, factId: last.factId })
          : undefined;
      return sendProjection(reply, {
        ...view,
        entries,
        ...(nextCursor === undefined ? {} : { nextCursor }),
      });
    } catch (error) {
      const problem = mapApplicationError(error, 'history_query');
      return reply.code(problem.status).send(problem);
    }
  });

  app.get('/api/v1/courses/:courseId/summary', async (request, reply) => {
    try {
      const courseId = (request.params as { courseId: string }).courseId;
      const view = requireSnapshot(await options.queries.getCourseSummary());
      return sendProjection(reply, {
        ...view,
        course: view.courses.find((course) => course.courseId === courseId),
      });
    } catch (error) {
      const problem = mapApplicationError(error, 'course_summary_query');
      return reply.code(problem.status).send(problem);
    }
  });

  app.get('/api/v1/history/stats', async (_request, reply) => {
    try {
      return sendProjection(reply, requireSnapshot(await options.queries.getStatistics()));
    } catch (error) {
      const problem = mapApplicationError(error, 'statistics_query');
      return reply.code(problem.status).send(problem);
    }
  });

  app.get('/api/v1/history/calendar', async (request, reply) => {
    try {
      const query = CalendarQuerySchema.parse(request.query);
      const from = Date.parse(`${query.from}T00:00:00.000Z`);
      const to = Date.parse(`${query.to}T00:00:00.000Z`);
      if (to < from || to - from > 365 * 86_400_000) {
        throw new HttpContractError('request_invalid', 400);
      }
      const view = requireSnapshot(await options.queries.getCalendar());
      return sendProjection(reply, {
        ...view,
        days: view.days.filter((day) => day.localDate >= query.from && day.localDate <= query.to),
      });
    } catch (error) {
      const problem = mapApplicationError(error, 'calendar_query');
      return reply.code(problem.status).send(problem);
    }
  });

  app.get('/api/v1/history/weeks/:isoWeek', async (request, reply) => {
    try {
      const isoWeek = IsoWeekSchema.parse((request.params as { isoWeek: string }).isoWeek);
      const view = requireSnapshot(await options.queries.getWeekly());
      const { weeks, ...projection } = view;
      return sendProjection(reply, {
        ...projection,
        week: weeks.find((item) => item.isoWeek === isoWeek),
      });
    } catch (error) {
      const problem = mapApplicationError(error, 'weekly_query');
      return reply.code(problem.status).send(problem);
    }
  });

  app.get('/api/v1/weekly-reports/:localWeekKey', async (request, reply) => {
    try {
      const key = IsoWeekSchema.parse((request.params as { localWeekKey: string }).localWeekKey);
      const report = await options.queries.getWeeklyReport(key);
      if (report === undefined) throw notFound();
      return reply.header('etag', `"${report.resourceVersion}"`).code(200).send(report);
    } catch (error) {
      const problem = mapApplicationError(error, 'weekly_report_query');
      return reply.code(problem.status).send(problem);
    }
  });
}
