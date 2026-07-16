import { z } from 'zod';

const identifier = z.string().trim().min(1).max(200);
const resourceVersion = z.number().int().nonnegative();

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

export const LearningSessionCommandResponseSchema = z.looseObject({
  lessonId: identifier,
  progress: z.enum(['not_started', 'in_progress', 'abandoned', 'completed']),
  sessionId: identifier.optional(),
  resourceVersion,
  writable: z.boolean(),
  leaseToken: identifier.optional(),
});

export const LessonTeachingProgressSchema = z.strictObject({
  ledgerVersion: z.number().int().nonnegative(),
  observationStatus: z.enum(['current', 'pending', 'failed']),
  lessonPhase: z.enum([
    'warmup',
    'knowledge_point',
    'comprehensive_check',
    'summary',
    'ready_to_close',
  ]),
  activeKnowledgePointRef: z.string().trim().min(1).max(2_000).optional(),
  comprehensiveCheck: z.enum(['pending', 'checking', 'passed', 'skipped']),
  closureInquiry: z.enum(['pending', 'awaiting_confirmation', 'confirmed_no_questions']),
  summaryStatus: z.enum(['pending', 'delivered']),
  knowledgePoints: z.array(
    z.strictObject({
      ref: z.string().trim().min(1).max(2_000),
      title: z.string().trim().min(1).max(2_000),
      progress: z.enum(['pending', 'teaching', 'checking', 'passed', 'skipped']),
      delivery: z.enum(['not_addressed', 'explained']),
      verification: z.enum(['not_observed', 'supporting', 'limiting', 'mixed']),
      unresolvedQuestionCount: z.number().int().nonnegative(),
    }),
  ),
});

export const LearningSessionViewResponseSchema = z.strictObject({
  learning: z.strictObject({
    lessonId: identifier,
    progress: z.enum(['not_started', 'in_progress', 'abandoned', 'completed']),
    session: z
      .strictObject({
        id: identifier,
        state: z.enum(['active', 'paused', 'frozen', 'closed']),
        messageIds: z.array(identifier),
        evidenceCheckpoint: z.boolean(),
        activeGenerationTaskId: identifier.optional(),
        stageReviewId: identifier.optional(),
        finalReviewId: identifier.optional(),
      })
      .optional(),
    processedCommandIds: z.array(identifier),
  }),
  resourceVersion,
  actualSeconds: z.number().int().nonnegative(),
  sessionSnapshotHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  teachingProgress: LessonTeachingProgressSchema.optional(),
  messages: z
    .array(
      z.strictObject({
        id: identifier,
        role: z.enum(['user', 'assistant']),
        createdAt: z.iso.datetime({ offset: true }),
        markdown: z.string(),
        generationTaskId: identifier.optional(),
      }),
    )
    .optional(),
  closurePreparation: z
    .strictObject({
      sessionId: identifier,
      sourceSessionIds: z.array(identifier).min(1),
      sourceMessageIds: z.array(identifier).min(1),
      messageRangeChecksum: z.string().regex(/^[a-f0-9]{64}$/),
      endIntent: z.string().min(1),
    })
    .optional(),
  finalReview: z
    .strictObject({
      id: identifier,
      artifactRef: identifier,
      contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
      sourceSessionIds: z.array(identifier),
      messageRangeChecksum: z.string().regex(/^[a-f0-9]{64}$/),
      committedAt: z.iso.datetime({ offset: true }),
      markdown: z.string().optional(),
    })
    .optional(),
});

export const LessonRecordMessageSchema = z.strictObject({
  id: identifier,
  role: z.enum(['user', 'assistant']),
  markdown: z.string(),
});

export const LessonRecordResponseSchema = z.strictObject({
  lessonId: identifier,
  courseId: identifier,
  title: z.string().min(1),
  courseTitle: z.string().min(1),
  completedAt: z.iso.datetime({ offset: true }),
  actualSeconds: z.number().int().nonnegative(),
  original: z.strictObject({
    sessionId: identifier,
    label: z.string(),
    messages: z.array(LessonRecordMessageSchema),
  }),
  supplementary: z.array(
    z.strictObject({
      sessionId: identifier,
      label: z.string(),
      createdAt: z.iso.datetime({ offset: true }),
      messages: z.array(LessonRecordMessageSchema),
    }),
  ),
  finalReviewMarkdown: z.string(),
});

export const LessonEntryStateResponseSchema = z.strictObject({
  lessonId: identifier,
  progress: z.enum(['not_started', 'in_progress', 'abandoned', 'completed']),
  sessionId: identifier.optional(),
  stageReviewMarkdown: z.string().optional(),
  resourceVersion,
});

export type LearningSessionView = Readonly<z.infer<typeof LearningSessionViewResponseSchema>>;
export type LessonTeachingProgress = Readonly<z.infer<typeof LessonTeachingProgressSchema>>;
export type LearningSessionCommandView = Readonly<
  z.infer<typeof LearningSessionCommandResponseSchema>
>;
export type LessonRecordView = Readonly<z.infer<typeof LessonRecordResponseSchema>>;
