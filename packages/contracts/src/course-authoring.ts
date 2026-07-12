import { z } from 'zod';

const identifierSchema = z.string().trim().min(1).max(200);
const resourceVersionSchema = z.number().int().nonnegative();
const outlineSessionStateSchema = z.enum([
  'collecting-input',
  'assessing',
  'ready-for-candidates',
  'generating-candidates',
  'candidate-ready',
  'confirming',
  'confirmed',
]);

export const COURSE_MODES = [
  'standard',
  'brainstorm',
  'argument_clash',
  'case_study',
  'business_insight',
  'process_decomposition',
  'decision_analysis',
  'cross_explore',
  'reading_seminar',
] as const;

export const CourseModeSchema = z.enum(COURSE_MODES);

export const CreateOutlineSessionBodySchema = z.strictObject({
  topic: z.string().trim().min(1).max(2_000),
  courseMode: CourseModeSchema,
});

export const AppendOutlineSessionMessageBodySchema = z.strictObject({
  content: z.string().trim().min(1).max(100_000),
});

export const RequestCandidateGenerationBodySchema = z.strictObject({});

export const ConfirmOutlineCandidateBodySchema = z.strictObject({
  candidateVersionId: identifierSchema,
});

export const ReviseCourseOutlineBodySchema = z.strictObject({
  sourceCandidateVersionId: identifierSchema,
});

export const OutlineSessionParamsSchema = z.strictObject({
  sessionId: identifierSchema,
});

export const CourseParamsSchema = z.strictObject({
  courseId: identifierSchema,
});

export const OutlineSessionResponseSchema = z.strictObject({
  outlineSessionId: identifierSchema,
  resourceVersion: resourceVersionSchema,
  state: outlineSessionStateSchema,
});

export const OutlineSessionViewResponseSchema = z.strictObject({
  outlineSessionId: identifierSchema,
  resourceVersion: resourceVersionSchema,
  state: outlineSessionStateSchema,
  topic: z.string().trim().min(1).max(2_000),
  courseMode: CourseModeSchema,
  candidateVersionIds: z.array(identifierSchema),
  candidateVersionId: identifierSchema.optional(),
  candidateMarkdown: z.string().optional(),
  confirmedCourseId: identifierSchema.optional(),
});

export const OutlineMessageResponseSchema = z.strictObject({
  outlineSessionId: identifierSchema,
  state: outlineSessionStateSchema,
  resourceVersion: resourceVersionSchema,
});

export const GenerationAcceptedResponseSchema = z.strictObject({
  taskId: identifierSchema,
  draftArtifactRef: identifierSchema.optional(),
  state: z.string().trim().min(1).max(100),
  resourceVersion: resourceVersionSchema,
});

export const ConfirmationResponseSchema = z.strictObject({
  courseId: identifierSchema,
  outlineVersionId: identifierSchema.optional(),
  resourceVersion: resourceVersionSchema,
});

export const OutlineRevisionResponseSchema = z.strictObject({
  courseId: identifierSchema,
  outlineVersionId: identifierSchema,
  resourceVersion: resourceVersionSchema,
});

export type CourseMode = (typeof COURSE_MODES)[number];
export type CreateOutlineSessionBody = Readonly<z.infer<typeof CreateOutlineSessionBodySchema>>;
export type AppendOutlineSessionMessageBody = Readonly<
  z.infer<typeof AppendOutlineSessionMessageBodySchema>
>;
