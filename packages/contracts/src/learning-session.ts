import { z } from 'zod';

const identifier = z.string().trim().min(1).max(200);

export const StartLessonSessionBodySchema = z.strictObject({});
export const AppendLessonMessageBodySchema = z.strictObject({
  markdown: z.string().trim().min(1).max(200_000),
});
export const EmptyLearningSessionCommandBodySchema = z.strictObject({});
export const StopLessonGenerationBodySchema = z.strictObject({ taskId: identifier });
export const StartSupplementarySessionBodySchema = z.strictObject({});
export const AppendSupplementaryMessageBodySchema = z.strictObject({
  markdown: z.string().trim().min(1).max(200_000),
});

export const LessonSessionStartedResponseSchema = z.strictObject({
  lessonId: identifier,
  sessionId: identifier,
  resourceVersion: z.number().int().nonnegative(),
  writable: z.boolean(),
  leaseToken: identifier.optional(),
});
export const GenerationTaskAcceptedResponseSchema = z.strictObject({
  taskId: identifier,
  resourceVersion: z.number().int().nonnegative(),
});
export const GenerationStoppedResponseSchema = z.strictObject({
  taskId: identifier,
  draftArtifactRef: identifier,
  resourceVersion: z.number().int().nonnegative(),
});
export const SupplementarySessionResponseSchema = z.strictObject({
  id: identifier,
  courseId: identifier,
  lessonId: identifier,
  sourceFinalReviewId: identifier,
  status: z.enum(['active', 'archived']),
  messageIds: z.array(identifier),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  resourceVersion: z.number().int().nonnegative(),
});
