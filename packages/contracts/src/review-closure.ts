import { z } from 'zod';

const identifier = z.string().trim().min(1).max(200);
const checksum = z.string().regex(/^[a-f0-9]{64}$/);

export const AbandonLessonBodySchema = z.strictObject({ sourceSnapshotHash: checksum });
export const RestoreLessonBodySchema = z.strictObject({});
export const BeginLessonClosureBodySchema = z.strictObject({
  sessionId: identifier,
  // Compatibility-only hints. The server freezes and authorizes the actual Review source range.
  sourceSessionIds: z.array(identifier).min(1).optional(),
  sourceMessageIds: z.array(identifier).min(1).optional(),
  messageRangeChecksum: checksum.optional(),
  endIntent: z.string().trim().min(1).max(2_000),
});
export const CloseCourseBodySchema = z.strictObject({ confirmAbandoned: z.boolean() });

export const LessonProgressCommandResponseSchema = z.looseObject({
  progress: z.enum(['not_started', 'in_progress', 'abandoned', 'completed']),
  resourceVersion: z.number().int().nonnegative(),
  reviewStatus: z.enum(['generating', 'failed', 'ready']).optional(),
});

export const LessonClosureResponseSchema = z.looseObject({
  transactionId: identifier,
  lessonId: identifier.optional(),
  state: z
    .enum([
      'open',
      'generating',
      'generating-failed',
      'review-ready',
      'committing',
      'completed',
      'cancelled',
    ])
    .optional(),
  generationTaskId: identifier.optional(),
  finalReviewId: identifier.optional(),
  errorCode: z.string().optional(),
  draftArtifactRef: identifier.optional(),
  review: z.looseObject({ artifactRef: identifier, markdown: z.string() }).optional(),
  resourceVersion: z.number().int().nonnegative(),
});

export const CourseReviewResponseSchema = z.looseObject({
  state: z.string(),
  artifactRef: identifier.optional(),
  markdown: z.string().optional(),
  resourceVersion: z.number().int().nonnegative(),
});

export type LessonClosureView = Readonly<z.infer<typeof LessonClosureResponseSchema>>;
export type CourseReviewView = Readonly<z.infer<typeof CourseReviewResponseSchema>>;
