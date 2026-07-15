import { z } from 'zod';

import { CourseModeSchema } from './course-authoring.js';

const identifier = z.string().trim().min(1).max(200);

export const HomeLessonSchema = z.strictObject({
  courseId: identifier,
  lessonId: identifier,
  title: z.string(),
  objective: z.string().optional(),
  coreKnowledgePoints: z.array(z.string().min(1)).optional(),
  estimatedMinutes: z.number().int().positive().optional(),
  progress: z.enum(['not_started', 'in_progress', 'abandoned', 'completed']),
  sessionId: identifier.optional(),
  recommended: z.boolean(),
  recommendation: z
    .strictObject({
      versionId: identifier,
      rank: z.number().int().positive(),
      rationale: z.string(),
      evidenceRefs: z.array(identifier),
      confidence: z.number().min(0).max(1),
      expiresAt: z.iso.datetime({ offset: true }),
      status: z.enum(['current', 'stale', 'fallback']),
      warnings: z.array(z.string()),
    })
    .optional(),
  lastActivityAt: z.iso.datetime({ offset: true }).optional(),
});

export const HomeDashboardResponseSchema = z.strictObject({
  generatedAt: z.iso.datetime({ offset: true }),
  draftSessions: z.array(
    z.strictObject({
      outlineSessionId: identifier,
      topic: z.string(),
      courseMode: CourseModeSchema,
      state: z.string(),
      resourceVersion: z.number().int().nonnegative(),
    }),
  ),
  courses: z.array(
    z.strictObject({
      courseId: identifier,
      title: z.string(),
      status: z.enum(['active', 'closed']),
      courseMode: CourseModeSchema,
      outlineVersionId: identifier,
      disciplineTag: z.string().trim().min(1).optional(),
      topicTags: z.array(z.string().trim().min(1)).optional(),
      resourceVersion: z.number().int().nonnegative(),
    }),
  ),
  lessons: z.array(HomeLessonSchema),
  schedule: z.array(
    z.strictObject({
      scheduleItemId: identifier,
      courseId: identifier,
      lessonId: identifier,
      startAt: z.iso.datetime({ offset: true }),
      endAt: z.iso.datetime({ offset: true }),
      source: z.enum(['manual', 'plan-flow']),
      locked: z.boolean(),
    }),
  ),
});

export type HomeDashboardView = Readonly<z.infer<typeof HomeDashboardResponseSchema>>;
