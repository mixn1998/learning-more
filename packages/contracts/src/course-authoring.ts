import { z } from 'zod';

const identifierSchema = z.string().trim().min(1).max(200);
const resourceVersionSchema = z.number().int().nonnegative();
const outlineSessionStateSchema = z.enum([
  'collecting-input',
  'assessing',
  'assessment-turn-running',
  'assessment-ready',
  'alignment-turn-running',
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

export const KnowledgeChainNodeSchema = z.strictObject({
  id: identifierSchema,
  content: z.string().trim().min(1).max(2_000),
  relationToNext: z.string().trim().min(1).max(2_000).optional(),
});

export const KnowledgeChainBranchSchema = z.strictObject({
  id: identifierSchema,
  attachedTo: identifierSchema,
  content: z.string().trim().min(1).max(2_000),
  relation: z.string().trim().min(1).max(2_000),
});

export const LessonKnowledgeStructureSchema = z
  .strictObject({
    mainChain: z.array(KnowledgeChainNodeSchema).min(1).max(50),
    branches: z.array(KnowledgeChainBranchSchema).max(100),
  })
  .superRefine((structure, context) => {
    const nodeIds = structure.mainChain.map((node) => node.id);
    if (new Set(nodeIds).size !== nodeIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['mainChain'],
        message: 'knowledge_chain_node_ids_must_be_unique',
      });
    }
    const branchIds = structure.branches.map((branch) => branch.id);
    if (new Set(branchIds).size !== branchIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['branches'],
        message: 'knowledge_chain_branch_ids_must_be_unique',
      });
    }
    if (branchIds.some((id) => nodeIds.includes(id))) {
      context.addIssue({
        code: 'custom',
        path: ['branches'],
        message: 'knowledge_chain_ids_must_be_unique',
      });
    }
    for (const [index, node] of structure.mainChain.entries()) {
      const isLast = index === structure.mainChain.length - 1;
      if (!isLast && node.relationToNext === undefined) {
        context.addIssue({
          code: 'custom',
          path: ['mainChain', index, 'relationToNext'],
          message: 'knowledge_chain_relation_required',
        });
      }
      if (isLast && node.relationToNext !== undefined) {
        context.addIssue({
          code: 'custom',
          path: ['mainChain', index, 'relationToNext'],
          message: 'knowledge_chain_terminal_relation_forbidden',
        });
      }
    }
    const knownNodes = new Set(nodeIds);
    for (const [index, branch] of structure.branches.entries()) {
      if (!knownNodes.has(branch.attachedTo)) {
        context.addIssue({
          code: 'custom',
          path: ['branches', index, 'attachedTo'],
          message: 'knowledge_chain_branch_anchor_unknown',
        });
      }
    }
  });

function legacyKnowledgeStructure(coreKnowledgePoints: readonly string[]) {
  return {
    mainChain: coreKnowledgePoints.map((content, index) => ({
      id: `node_${index + 1}`,
      content,
      ...(index === coreKnowledgePoints.length - 1
        ? {}
        : { relationToNext: '为下一步理解提供基础' }),
    })),
    branches: [],
  };
}

/**
 * `coreKnowledgePoints` remains an output compatibility projection for the
 * teaching ledger. New model output is authoritative through
 * `knowledgeStructure`; legacy v1 candidates are upgraded while parsing.
 */
export const CandidateLessonSchema = z
  .strictObject({
    id: identifierSchema,
    title: z.string().min(1),
    objective: z.string().min(1),
    knowledgeStructure: LessonKnowledgeStructureSchema.optional(),
    coreKnowledgePoints: z.array(z.string().min(1)).min(1).optional(),
    prerequisiteLessonIds: z.array(identifierSchema),
    estimatedMinutes: z.number().int().min(5).max(480),
    sourceRefs: z.array(identifierSchema).min(1),
  })
  .superRefine((lesson, context) => {
    if (lesson.knowledgeStructure === undefined && lesson.coreKnowledgePoints === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['knowledgeStructure'],
        message: 'lesson_knowledge_structure_required',
      });
    }
    if (
      lesson.knowledgeStructure !== undefined &&
      lesson.coreKnowledgePoints !== undefined &&
      JSON.stringify(lesson.knowledgeStructure.mainChain.map((node) => node.content)) !==
        JSON.stringify(lesson.coreKnowledgePoints)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['coreKnowledgePoints'],
        message: 'core_knowledge_points_must_match_main_chain',
      });
    }
  })
  .transform((lesson) => {
    const knowledgeStructure =
      lesson.knowledgeStructure ?? legacyKnowledgeStructure(lesson.coreKnowledgePoints ?? []);
    return {
      ...lesson,
      knowledgeStructure,
      coreKnowledgePoints: knowledgeStructure.mainChain.map((node) => node.content),
    };
  });

export const CandidateModuleSchema = z.strictObject({
  id: identifierSchema,
  title: z.string().min(1),
  lessonIds: z.array(identifierSchema).min(1),
});

export const CandidateOutlineMetadataSchema = z.strictObject({
  courseGoals: z.array(z.string().min(1)).min(1).max(12),
  disciplineTag: z.string().min(1),
  // Tags are descriptive metadata, not a teaching-shape constraint. Keep the
  // machine contract concerned with non-empty values while allowing the model
  // to preserve a richer set of relevant concepts from the learner's goal.
  topicTags: z.array(z.string().min(1)).min(1),
  modules: z.array(CandidateModuleSchema).min(1).max(50),
  lessons: z.array(CandidateLessonSchema).min(1).max(100),
});

/**
 * Untrusted model output at the provider seam. Course/session identity,
 * source permissions, and lifecycle state are deliberately server-owned.
 */
export const CandidateModelResponseSchema = z.strictObject({
  protocol: z.literal('learning-more.candidate'),
  schemaVersion: z.literal(1),
  outline: CandidateOutlineMetadataSchema,
});

export type CandidateLesson = Readonly<z.infer<typeof CandidateLessonSchema>>;
export type CandidateModule = Readonly<z.infer<typeof CandidateModuleSchema>>;
export type CandidateOutlineMetadata = Readonly<z.infer<typeof CandidateOutlineMetadataSchema>>;
export type CandidateModelResponse = Readonly<z.infer<typeof CandidateModelResponseSchema>>;
export type KnowledgeChainNode = Readonly<z.infer<typeof KnowledgeChainNodeSchema>>;
export type KnowledgeChainBranch = Readonly<z.infer<typeof KnowledgeChainBranchSchema>>;
export type LessonKnowledgeStructure = Readonly<z.infer<typeof LessonKnowledgeStructureSchema>>;

export const CandidateGenerationFailureCodeSchema = z.enum([
  'candidate_invalid',
  'generation_timeout',
  'generation_interrupted',
]);
export type CandidateGenerationFailureCode = z.infer<typeof CandidateGenerationFailureCodeSchema>;

export const CreateOutlineSessionBodySchema = z.strictObject({
  topic: z.string().trim().min(1).max(2_000),
  courseMode: CourseModeSchema,
});

export const CreateOutlineAdjustmentSessionBodySchema = z.strictObject({});

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

export const RenameCourseTitleBodySchema = z.strictObject({
  title: z.string().trim().min(1).max(200),
});

export const RenameCourseTitleResponseSchema = z.strictObject({
  courseId: identifierSchema,
  title: z.string().min(1).max(200),
  resourceVersion: resourceVersionSchema,
});

export const IngestOutlineMaterialBodySchema = z.strictObject({
  fileName: z.string().trim().min(1).max(500),
  mediaType: z.enum(['application/pdf', 'text/plain', 'text/markdown']),
  contentBase64: z
    .string()
    .min(1)
    .max(70_000_000)
    .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
});

export const OutlineMaterialResponseSchema = z.strictObject({
  outlineSessionId: identifierSchema,
  artifactRef: identifierSchema,
  originalFileName: z.string(),
  format: z.enum(['markdown', 'text', 'pdf']),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  importedAt: z.iso.datetime({ offset: true }),
  sections: z.array(
    z.strictObject({
      title: z.string(),
      level: z.number().int().positive(),
      startPage: z.number().int().positive().optional(),
      endPage: z.number().int().positive().optional(),
    }),
  ),
  warnings: z.array(z.string()),
  resourceVersion: resourceVersionSchema,
});

export type OutlineMaterialView = Readonly<z.infer<typeof OutlineMaterialResponseSchema>>;

export const OutlineSessionParamsSchema = z.strictObject({
  sessionId: identifierSchema,
});

export const CourseParamsSchema = z.strictObject({
  courseId: identifierSchema,
});

export const LessonParamsSchema = z.strictObject({
  lessonId: identifierSchema,
});

export const OutlineMessageSchema = z.strictObject({
  messageId: identifierSchema,
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1),
  status: z.enum(['complete', 'failed']),
  createdAt: z.iso.datetime({ offset: true }),
  inReplyToMessageId: identifierSchema.optional(),
  alignmentAction: z.enum(['clarify', 'regenerate', 'patch']).optional(),
  targetModuleIds: z.array(identifierSchema).optional(),
});

export const OutlineSessionResponseSchema = z.strictObject({
  outlineSessionId: identifierSchema,
  resourceVersion: resourceVersionSchema,
  state: outlineSessionStateSchema,
  topic: z.string().trim().min(1).max(2_000),
  courseMode: CourseModeSchema,
  completedAssessmentRounds: z.number().int().nonnegative(),
  canGenerateCandidate: z.boolean(),
  messages: z.array(OutlineMessageSchema),
});

export const OutlineSessionViewResponseSchema = z.strictObject({
  outlineSessionId: identifierSchema,
  resourceVersion: resourceVersionSchema,
  state: outlineSessionStateSchema,
  topic: z.string().trim().min(1).max(2_000),
  courseMode: CourseModeSchema,
  candidateVersionIds: z.array(identifierSchema),
  completedAssessmentRounds: z.number().int().nonnegative(),
  canGenerateCandidate: z.boolean(),
  savedAsDraft: z.boolean().optional(),
  messages: z.array(OutlineMessageSchema),
  generationTaskId: identifierSchema.optional(),
  candidateVersionId: identifierSchema.optional(),
  candidateMarkdown: z.string().optional(),
  confirmedCourseId: identifierSchema.optional(),
  materials: z
    .array(
      z.strictObject({
        artifactRef: identifierSchema,
        originalFileName: z.string(),
        format: z.enum(['markdown', 'text', 'pdf']),
        importedAt: z.iso.datetime({ offset: true }),
        sections: z.array(z.string()),
        warnings: z.array(z.string()),
      }),
    )
    .optional(),
});

export const OutlineMessageResponseSchema = z.strictObject({
  outlineSessionId: identifierSchema,
  state: outlineSessionStateSchema,
  resourceVersion: resourceVersionSchema,
  completedAssessmentRounds: z.number().int().nonnegative(),
  canGenerateCandidate: z.boolean(),
});

export const GenerationAcceptedResponseSchema = z.strictObject({
  taskId: identifierSchema,
  draftArtifactRef: identifierSchema.optional(),
  state: z.string().trim().min(1).max(100),
  failureCode: CandidateGenerationFailureCodeSchema.optional(),
  resourceVersion: resourceVersionSchema,
});

export const CancelCandidateGenerationResponseSchema = z.strictObject({
  outlineSessionId: identifierSchema,
  state: outlineSessionStateSchema,
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

export const DeleteCourseArchiveResponseSchema = z.strictObject({
  courseId: identifierSchema,
  deletedAt: z.iso.datetime({ offset: true }),
  portraitRefresh: z.literal('updating'),
});

export const DeleteOutlineSessionResponseSchema = z.strictObject({
  outlineSessionId: identifierSchema,
  deletedAt: z.iso.datetime({ offset: true }),
});

export const SaveOutlineSessionDraftResponseSchema = z.strictObject({
  outlineSessionId: identifierSchema,
  resourceVersion: resourceVersionSchema,
});

export const CourseArchiveResponseSchema = z.strictObject({
  courseId: identifierSchema,
  title: z.string(),
  status: z.enum(['active', 'closed']),
  courseMode: CourseModeSchema,
  outlineVersionId: identifierSchema,
  lessonIds: z.array(identifierSchema),
  recommendedLessonId: identifierSchema.optional(),
  nextLessonRecommendation: z
    .strictObject({
      versionId: identifierSchema,
      recommendedLessonId: identifierSchema,
      rankedLessonIds: z.array(identifierSchema),
      rationale: z.string(),
      evidenceRefs: z.array(identifierSchema),
      confidence: z.number().min(0).max(1),
      expiresAt: z.iso.datetime({ offset: true }),
      sourceSnapshotHash: z.string().regex(/^[a-f0-9]{64}$/),
      status: z.enum(['current', 'stale', 'fallback']),
      warnings: z.array(z.string()),
    })
    .optional(),
  outlineMarkdown: z.string().optional(),
  lessons: z
    .array(
      z.strictObject({
        lessonId: identifierSchema,
        outlineVersionId: identifierSchema,
        title: z.string(),
        objective: z.string(),
        coreKnowledgePoints: z.array(z.string()),
        knowledgeStructure: LessonKnowledgeStructureSchema.optional(),
        prerequisiteLessonIds: z.array(identifierSchema),
        estimatedMinutes: z.number().int().positive(),
      }),
    )
    .optional(),
  outlineVersions: z
    .array(
      z.strictObject({
        outlineVersionId: identifierSchema,
        sourceCandidateVersionId: identifierSchema,
        createdAt: z.iso.datetime({ offset: true }),
        current: z.boolean(),
      }),
    )
    .optional(),
  resourceVersion: resourceVersionSchema,
});

export const CourseOutlineVersionResponseSchema = z.strictObject({
  courseId: identifierSchema,
  outlineVersionId: identifierSchema,
  sourceCandidateVersionId: identifierSchema,
  outlineMarkdown: z.string(),
  disciplineTag: z.string(),
  topicTags: z.array(z.string()),
  createdAt: z.iso.datetime({ offset: true }),
  resourceVersion: resourceVersionSchema,
  current: z.boolean(),
});

export type CourseArchiveView = Readonly<z.infer<typeof CourseArchiveResponseSchema>>;
export type CourseOutlineVersionView = Readonly<z.infer<typeof CourseOutlineVersionResponseSchema>>;

export const LessonPreviewResponseSchema = z.strictObject({
  lessonId: identifierSchema,
  courseId: identifierSchema,
  outlineVersionId: identifierSchema,
  title: z.string(),
  objective: z.string(),
  coreKnowledgePoints: z.array(z.string().min(1)),
  knowledgeStructure: LessonKnowledgeStructureSchema.optional(),
  knowledgePointWeights: z.array(z.enum(['normal', 'key'])).optional(),
  teachingWeightStatus: z.enum(['pending', 'completed', 'failed']).optional(),
  estimatedMinutes: z.number().int().positive(),
});

export type CourseMode = (typeof COURSE_MODES)[number];
export type CreateOutlineSessionBody = Readonly<z.infer<typeof CreateOutlineSessionBodySchema>>;
export type AppendOutlineSessionMessageBody = Readonly<
  z.infer<typeof AppendOutlineSessionMessageBodySchema>
>;
