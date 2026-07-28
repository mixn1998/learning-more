import { z } from 'zod';

export const LearningNoteSchema = z.strictObject({
  id: z.string().min(1),
  title: z.string().trim().min(1).max(200),
  markdown: z.string().trim().min(1).max(20_000),
  discipline: z.string().min(1),
  courseId: z.string().min(1),
  courseTitle: z.string().min(1),
  lessonId: z.string().min(1),
  lessonTitle: z.string().min(1),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  resourceVersion: z.number().int().positive(),
});

export const LearningNoteListResponseSchema = z.strictObject({
  entries: z.array(LearningNoteSchema),
});

export const CreateLearningNoteBodySchema = z.strictObject({
  courseId: z.string().min(1),
  lessonId: z.string().min(1),
  title: z.string().trim().min(1).max(200).optional(),
  markdown: z.string().trim().min(1).max(20_000),
});

export const UpdateLearningNoteBodySchema = z.strictObject({
  title: z.string().trim().min(1).max(200),
  markdown: z.string().trim().min(1).max(20_000),
});

export const LearningNoteParamsSchema = z.strictObject({
  noteId: z.string().min(1),
});

export const LearningNoteListQuerySchema = z.strictObject({
  courseId: z.string().min(1).optional(),
  lessonId: z.string().min(1).optional(),
});

export type LearningNoteView = Readonly<z.infer<typeof LearningNoteSchema>>;
export type CreateLearningNoteBody = Readonly<z.infer<typeof CreateLearningNoteBodySchema>>;
export type UpdateLearningNoteBody = Readonly<z.infer<typeof UpdateLearningNoteBodySchema>>;
