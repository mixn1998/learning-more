import { z } from 'zod';

export const HistoryQuerySchema = z.strictObject({
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).max(2_000).optional(),
});

export const CalendarQuerySchema = z.strictObject({
  from: z.iso.date(),
  to: z.iso.date(),
});

export const IsoWeekSchema = z.string().regex(/^\d{4}-W\d{2}$/);

export const ProjectionStatusSchema = z.strictObject({
  asOfEventId: z.string().min(1).optional(),
  projectionVersion: z.number().int().positive(),
  freshness: z.enum(['current', 'stale', 'rebuilding']),
});

export const HistoryEntrySchema = z.strictObject({
  factId: z.string().min(1),
  factType: z.string().min(1),
  occurredAt: z.iso.datetime({ offset: true }),
  subjectRefs: z.record(z.string(), z.string()),
  payload: z.record(z.string(), z.unknown()),
});

export const HistoryPageResponseSchema = ProjectionStatusSchema.extend({
  entries: z.array(HistoryEntrySchema),
  nextCursor: z.string().min(1).optional(),
});

export const StatisticsResponseSchema = ProjectionStatusSchema.extend({
  totalActualSeconds: z.number().nonnegative(),
  validSessionCount: z.number().int().nonnegative(),
  lessonCompletedCount: z.number().int().nonnegative(),
  lessonAbandonedCount: z.number().int().nonnegative(),
  lessonRestoredCount: z.number().int().nonnegative(),
  courseClosedCount: z.number().int().nonnegative(),
  activeDayCount: z.number().int().nonnegative(),
  currentStreakDays: z.number().int().nonnegative(),
  longestStreakDays: z.number().int().nonnegative(),
  definitions: z.record(z.string(), z.string()),
});

export const CalendarDaySchema = z.strictObject({
  localDate: z.iso.date(),
  actualSeconds: z.number().nonnegative(),
  completedLessonIds: z.array(z.string().min(1)),
});

export const CalendarResponseSchema = ProjectionStatusSchema.extend({
  days: z.array(CalendarDaySchema),
});

export const CourseSummarySchema = z.strictObject({
  courseId: z.string().min(1),
  status: z.enum(['active', 'closed']),
  createdAt: z.iso.datetime({ offset: true }).optional(),
  closedAt: z.iso.datetime({ offset: true }).optional(),
  completedLessonCount: z.number().int().nonnegative(),
  actualSeconds: z.number().nonnegative(),
  finalReviewCount: z.number().int().nonnegative(),
});

export const CourseSummaryResponseSchema = ProjectionStatusSchema.extend({
  courses: z.array(CourseSummarySchema),
  course: CourseSummarySchema.optional(),
});

export const WeeklySummarySchema = z.strictObject({
  isoWeek: IsoWeekSchema,
  timezone: z.string().min(1),
  actualSeconds: z.number().nonnegative(),
  completedLessonCount: z.number().int().nonnegative(),
  activeDayCount: z.number().int().nonnegative(),
});

export const WeeklyResponseSchema = ProjectionStatusSchema.extend({
  week: WeeklySummarySchema.optional(),
});

export const WeeklyFactSnapshotEntrySchema = z.strictObject({
  factId: z.string().min(1),
  sourceRef: z.string().min(1).optional(),
  kind: z
    .enum([
      'learning-session',
      'teaching-ledger',
      'review',
      'plan-change',
      'reasoning-evidence',
      'fact',
    ])
    .optional(),
  occurredAt: z.iso.datetime({ offset: true }),
  summary: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  courseId: z.string().min(1).optional(),
  lessonId: z.string().min(1).optional(),
  actualSeconds: z.number().nonnegative(),
  disciplineTag: z.string().min(1).optional(),
  topicTags: z.array(z.string()),
});

export const WeeklyReportResponseSchema = z.strictObject({
  localWeekKey: IsoWeekSchema,
  timezone: z.string().min(1),
  startLocalDate: z.iso.date(),
  endLocalDate: z.iso.date(),
  state: z.enum(['generating', 'failed', 'finalized']),
  factSnapshot: z.array(WeeklyFactSnapshotEntrySchema),
  factSnapshotHash: z.string().min(1),
  sourceRefs: z.array(z.string().min(1)).optional(),
  snapshotExclusions: z.array(z.string()).optional(),
  projectionCursor: z.string().min(1).optional(),
  metricDefinitionVersion: z.number().int().positive(),
  generationTaskId: z.string().min(1),
  artifactRef: z.string().min(1).optional(),
  contentSha256: z.string().min(1).optional(),
  errorCode: z.string().min(1).optional(),
  draftArtifactRef: z.string().min(1).optional(),
  markdown: z.string().optional(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  resourceVersion: z.number().int().nonnegative(),
});

export type ProjectionStatus = Readonly<z.infer<typeof ProjectionStatusSchema>>;
export type HistoryEntry = Readonly<z.infer<typeof HistoryEntrySchema>>;
export type HistoryPageResponse = Readonly<z.infer<typeof HistoryPageResponseSchema>>;
export type StatisticsResponse = Readonly<z.infer<typeof StatisticsResponseSchema>>;
export type CalendarDay = Readonly<z.infer<typeof CalendarDaySchema>>;
export type CalendarResponse = Readonly<z.infer<typeof CalendarResponseSchema>>;
export type CourseSummary = Readonly<z.infer<typeof CourseSummarySchema>>;
export type CourseSummaryResponse = Readonly<z.infer<typeof CourseSummaryResponseSchema>>;
export type WeeklySummary = Readonly<z.infer<typeof WeeklySummarySchema>>;
export type WeeklyResponse = Readonly<z.infer<typeof WeeklyResponseSchema>>;
export type WeeklyReportResponse = Readonly<z.infer<typeof WeeklyReportResponseSchema>>;
