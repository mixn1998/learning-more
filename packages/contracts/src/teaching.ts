import { z } from 'zod';

const IdentifierSchema = z.string().trim().min(1).max(500);
const SourceRefSchema = z.string().trim().min(1).max(2_000);
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);

export const TeachingScopeAlignmentSchema = z.enum([
  'direct',
  'supporting',
  'adjacent',
  'unclear',
  'off_scope',
]);

export const TeachingScopeRelationSchema = z
  .strictObject({
    alignment: TeachingScopeAlignmentSchema,
    relationRefs: z.array(SourceRefSchema),
    rationale: z.string().trim().min(1).max(10_000),
  })
  .superRefine((scope, context) => {
    if (
      ['direct', 'supporting', 'adjacent'].includes(scope.alignment) &&
      scope.relationRefs.length === 0
    ) {
      context.addIssue({
        code: 'custom',
        path: ['relationRefs'],
        message: 'traceable_relation_required',
      });
    }
  });

export const TeachingObservationKindSchema = z.enum([
  'teaching_delivery',
  'learner_demonstration',
  'learner_misconception',
  'learner_question',
  'learner_intent',
  'learner_reasoning_behavior',
  'adjacent_exploration',
  'open_loop',
]);

export const TeachingObservationEntrySchema = z.strictObject({
  entryId: IdentifierSchema,
  kind: TeachingObservationKindSchema,
  summary: z.string().trim().min(1).max(20_000),
  knowledgePointRefs: z.array(SourceRefSchema),
  sourceRefs: z.array(SourceRefSchema).min(1),
  assessment: z.enum(['supports', 'limits', 'uncertain']).optional(),
  explicitness: z.enum(['user_declared', 'ai_observed']).optional(),
  elicitation: z.enum(['spontaneous', 'elicited', 'mixed', 'unknown']).optional(),
  resolvesEntryRefs: z.array(IdentifierSchema),
  qualityFlags: z.array(z.enum(['direct', 'complete', 'ambiguous'])),
});

export const TeachingObservationSchema = z.strictObject({
  observationId: IdentifierSchema,
  schemaVersion: z.literal(1),
  lessonId: IdentifierSchema,
  sessionId: IdentifierSchema,
  turnSequence: z.number().int().positive(),
  sourceMessageIds: z.array(IdentifierSchema).min(1),
  sourceSnapshotHash: Sha256Schema,
  scope: TeachingScopeRelationSchema,
  entries: z.array(TeachingObservationEntrySchema),
  observerVersion: IdentifierSchema,
  observedAt: z.iso.datetime({ offset: true }),
  status: z.enum(['active', 'superseded', 'retracted']),
});

export const TeachingKnowledgePointStateSchema = z.strictObject({
  ref: SourceRefSchema,
  delivery: z.enum(['not_addressed', 'explained']),
  verification: z.enum(['not_observed', 'supporting', 'limiting', 'mixed']),
  teachingEvidenceRefs: z.array(SourceRefSchema),
  learnerEvidenceRefs: z.array(SourceRefSchema),
  unresolvedEntryRefs: z.array(IdentifierSchema),
});

export const TeachingOpenLoopSchema = z.strictObject({
  entryId: IdentifierSchema,
  summary: z.string().trim().min(1).max(20_000),
  knowledgePointRefs: z.array(SourceRefSchema),
  sourceRefs: z.array(SourceRefSchema).min(1),
});

export const TeachingExplorationBranchSchema = z.strictObject({
  entryId: IdentifierSchema,
  summary: z.string().trim().min(1).max(20_000),
  courseTopicRefs: z.array(SourceRefSchema).min(1),
  sourceRefs: z.array(SourceRefSchema).min(1),
  returnAnchorRefs: z.array(SourceRefSchema).min(1),
  status: z.enum(['active', 'parked', 'returned']),
});

export const TeachingLearnerSignalSchema = z.strictObject({
  entryId: IdentifierSchema,
  summary: z.string().trim().min(1).max(20_000),
  explicitness: z.enum(['user_declared', 'ai_observed']),
  sourceRefs: z.array(SourceRefSchema).min(1),
});

export const TeachingStateSnapshotSchema = z.strictObject({
  schemaVersion: z.literal(1),
  lessonId: IdentifierSchema,
  sessionId: IdentifierSchema,
  ledgerVersion: z.number().int().nonnegative(),
  observedThroughMessageId: IdentifierSchema.optional(),
  sourceSnapshotHash: Sha256Schema,
  observationStatus: z.enum(['current', 'pending', 'failed']),
  scopeStatus: z.enum(['aligned', 'needs_return']),
  evidenceCheckpoint: z.boolean(),
  knowledgePoints: z.array(TeachingKnowledgePointStateSchema),
  openLoops: z.array(TeachingOpenLoopSchema),
  explorationBranches: z.array(TeachingExplorationBranchSchema),
  recentLearnerSignals: z.array(TeachingLearnerSignalSchema),
});

export const TeachingCheckpointReasonSchema = z.enum([
  'manual_pause',
  'evidenced_abandon',
  'lesson_closure',
]);

export const TeachingCheckpointSnapshotSchema = z
  .strictObject({
    checkpointId: IdentifierSchema,
    reason: TeachingCheckpointReasonSchema,
    lessonId: IdentifierSchema,
    sessionId: IdentifierSchema,
    teachingState: TeachingStateSnapshotSchema,
    observationRefs: z.array(SourceRefSchema),
    sourceMessageIds: z.array(IdentifierSchema),
    sourceSnapshotHash: Sha256Schema,
    observationCompleteness: z.enum(['complete', 'pending', 'failed']),
    retentionDecision: z.enum(['discardable', 'preserve']),
    frozenAt: z.iso.datetime({ offset: true }),
  })
  .superRefine((checkpoint, context) => {
    if (
      checkpoint.observationCompleteness !== 'complete' &&
      checkpoint.retentionDecision !== 'preserve'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['retentionDecision'],
        message: 'incomplete_observation_must_be_preserved',
      });
    }
  });

export type TeachingScopeAlignment = z.infer<typeof TeachingScopeAlignmentSchema>;
export type TeachingObservationEntry = Readonly<z.infer<typeof TeachingObservationEntrySchema>>;
export type TeachingObservation = Readonly<z.infer<typeof TeachingObservationSchema>>;
export type TeachingStateSnapshot = Readonly<z.infer<typeof TeachingStateSnapshotSchema>>;
export type TeachingCheckpointReason = z.infer<typeof TeachingCheckpointReasonSchema>;
export type TeachingCheckpointSnapshot = Readonly<z.infer<typeof TeachingCheckpointSnapshotSchema>>;
