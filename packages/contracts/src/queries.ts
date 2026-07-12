import { z } from 'zod';

import { QueryContextSchema } from './metadata.js';

export const QUERY_TYPES = [
  'GetOutlineSession',
  'ListResumableOutlineSessions',
  'GetCourseStructure',
  'GetOutlineVersion',
  'ListOutlineVersions',
  'GetCourseArchive',
  'GetLessonEntry',
  'GetLessonSession',
  'GetLessonArchive',
  'GetLessonProgress',
  'GetWriteLease',
  'ListPendingClosures',
  'GetLessonClosureStatus',
  'GetCourseReviewStatus',
  'GetLearningSchedule',
  'GetPlanningPool',
  'GetPlanFlow',
  'ListPlanFlows',
  'GetCourseSummary',
  'GetLearningHistory',
  'GetLearningHistoryStats',
  'GetLearningCalendar',
  'GetGlobalProfileFacts',
  'GetWeeklyReport',
  'GetProjectionHealth',
  'GetEvidenceBacklog',
  'GetEvidenceCompleteness',
  'GetPortraitEvidenceManifest',
  'GetCurrentPortrait',
  'GetPortraitGenerationStatus',
  'ListPortraitVersions',
  'GetGenerationTask',
  'ObserveGenerationTask',
  'GetProviderStatus',
  'GetRuntimeStatus',
] as const;

export const QueryTypeSchema = z.enum(QUERY_TYPES);

export const QueryEnvelopeSchema = z.strictObject({
  type: QueryTypeSchema,
  context: QueryContextSchema,
  parameters: z.record(z.string(), z.unknown()),
});

export type QueryType = (typeof QUERY_TYPES)[number];
export type QueryEnvelope = Readonly<z.infer<typeof QueryEnvelopeSchema>>;
