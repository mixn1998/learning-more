import { z } from 'zod';

export const EVENT_TYPES = [
  'OutlineSessionCreated',
  'CourseCreated',
  'OutlineVersionConfirmed',
  'LessonsDefined',
  'LessonSessionStarted',
  'LessonSessionPaused',
  'LessonAbandoned',
  'LessonRestored',
  'LessonClosingRequested',
  'ReviewCreated',
  'ReviewFinalized',
  'LessonSessionCompleted',
  'InteractionPrompted',
  'InteractionResponded',
  'InteractionSkipped',
  'RecommendedLessonChanged',
  'SupplementarySessionArchived',
  'CourseClosed',
  'CourseReviewFinalized',
  'SchedulePlanned',
  'ScheduleChanged',
  'ScheduleCancelled',
  'PlanFlowCreated',
  'PlanFlowPaused',
  'PlanFlowResumed',
  'PlanFlowReplanned',
  'PlanFlowDeleted',
  'PortraitEvidenceExtracted',
  'PortraitVersionCommitted',
] as const;

export const EventTypeSchema = z.enum(EVENT_TYPES);

export const LearningEventEnvelopeSchema = z.strictObject({
  id: z.string().trim().min(1).max(200),
  schema_version: z.number().int().positive(),
  type: EventTypeSchema,
  occurred_at: z.iso.datetime({ offset: true }),
  recorded_at: z.iso.datetime({ offset: true }),
  source: z.string().trim().min(1).max(100),
  target_refs: z.record(z.string(), z.string()),
  payload: z.record(z.string(), z.unknown()),
  idempotency_key: z.string().trim().min(1).max(200),
  correlation_id: z.string().trim().min(1).max(200),
});

export type EventType = (typeof EVENT_TYPES)[number];
export type LearningEventEnvelope = Readonly<z.infer<typeof LearningEventEnvelopeSchema>>;
