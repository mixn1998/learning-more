import { z } from 'zod';

import { CourseModeSchema } from './course-authoring.js';

const IdentifierSchema = z.string().trim().min(1).max(500);
const SourceRefSchema = z.string().trim().min(1).max(2_000);
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);

export const ReasoningElicitationSchema = z.enum(['spontaneous', 'elicited', 'mixed', 'unknown']);

export const ReasoningBehaviorEpisodeSchema = z.strictObject({
  episodeId: IdentifierSchema,
  schemaVersion: z.literal(1),
  courseId: IdentifierSchema,
  lessonId: IdentifierSchema,
  sessionId: IdentifierSchema,
  courseMode: CourseModeSchema,
  behaviorSummary: z.string().trim().min(1).max(20_000),
  sourceObservationRef: SourceRefSchema,
  sourceRefs: z.array(SourceRefSchema).min(1),
  sourceGroupId: IdentifierSchema,
  elicitation: ReasoningElicitationSchema,
  observedAt: z.iso.datetime({ offset: true }),
  sourceSnapshotHash: Sha256Schema,
  extractorVersion: IdentifierSchema,
  extractedAt: z.iso.datetime({ offset: true }),
  status: z.enum(['active', 'superseded', 'retracted']),
  resourceVersion: z.number().int().nonnegative(),
});

export const ReasoningDimensionDefinitionSchema = z.strictObject({
  dimensionId: IdentifierSchema,
  dimensionSetVersion: IdentifierSchema,
  label: z.string().trim().min(1).max(500),
  description: z.string().trim().min(1).max(5_000),
  inclusionSignals: z.array(z.string().trim().min(1).max(2_000)),
  exclusionSignals: z.array(z.string().trim().min(1).max(2_000)),
  derivedFromEpisodeIds: z.array(IdentifierSchema).min(1),
  /** Stable evidence-derived lineage key; never a predefined taxonomy. */
  semanticFingerprint: Sha256Schema.optional(),
  /** The earlier dynamic dimension continued by this revised definition. */
  continuesDimensionId: IdentifierSchema.optional(),
  /** Earlier dynamic definitions that this definition replaces. */
  supersedesDimensionIds: z.array(IdentifierSchema).optional(),
  analyzerVersion: IdentifierSchema,
  createdAt: z.iso.datetime({ offset: true }),
  status: z.enum(['active', 'superseded']),
});

export const ReasoningBehaviorClassificationSchema = z.strictObject({
  classificationId: IdentifierSchema,
  episodeId: IdentifierSchema,
  dimensionSetVersion: IdentifierSchema,
  labels: z.array(
    z.strictObject({
      dimensionId: IdentifierSchema,
      rationale: z.string().trim().min(1).max(5_000),
      confidence: z.number().min(0).max(1),
    }),
  ),
  analyzerVersion: IdentifierSchema,
  sourceSnapshotHash: Sha256Schema,
  classifiedAt: z.iso.datetime({ offset: true }),
  status: z.enum(['active', 'superseded', 'retracted']),
});

export const ReasoningAnalysisFilterSchema = z.strictObject({
  windowStart: z.iso.datetime({ offset: true }).optional(),
  windowEnd: z.iso.datetime({ offset: true }).optional(),
  courseIds: z.array(IdentifierSchema),
  lessonIds: z.array(IdentifierSchema),
  courseModes: z.array(CourseModeSchema),
  elicitations: z.array(ReasoningElicitationSchema),
});

export const ReasoningBehaviorAnalysisSnapshotSchema = z.strictObject({
  snapshotId: IdentifierSchema,
  schemaVersion: z.literal(1),
  dimensionSetVersion: IdentifierSchema,
  analyzerVersion: IdentifierSchema,
  sourceEpisodeIds: z.array(IdentifierSchema).min(1),
  filter: ReasoningAnalysisFilterSchema,
  eligibleEpisodeCount: z.number().int().nonnegative(),
  independentSourceGroupCount: z.number().int().nonnegative(),
  dimensions: z.array(
    z.strictObject({
      dimensionId: IdentifierSchema,
      episodeCount: z.number().int().nonnegative(),
      episodeShare: z.number().min(0).max(1),
      independentSourceGroupCount: z.number().int().nonnegative(),
      spontaneousCount: z.number().int().nonnegative(),
      elicitedCount: z.number().int().nonnegative(),
      mixedCount: z.number().int().nonnegative(),
      unknownCount: z.number().int().nonnegative(),
      courseCount: z.number().int().nonnegative(),
      lessonCount: z.number().int().nonnegative(),
    }),
  ),
  limitations: z.array(z.string().trim().min(1).max(2_000)),
  sourceSnapshotHash: Sha256Schema,
  createdAt: z.iso.datetime({ offset: true }),
  status: z.enum(['provisional', 'usable', 'stale']),
});

export const UserProfileEvidenceSchema = z
  .strictObject({
    evidenceId: IdentifierSchema,
    schemaVersion: z.literal(1),
    summary: z.string().trim().min(1).max(20_000),
    explicitness: z.enum(['user_declared', 'ai_observed']),
    sourceType: z.enum(['outline', 'lesson', 'supplementary', 'review', 'fact']),
    sourceRefs: z.array(SourceRefSchema).min(1),
    sourceGroupId: IdentifierSchema,
    dependentSourceGroupIds: z.array(IdentifierSchema),
    courseContext: z.string().trim().min(1).max(2_000).optional(),
    lessonContext: z.string().trim().min(1).max(2_000).optional(),
    observedAt: z.iso.datetime({ offset: true }),
    sourceSnapshotHash: Sha256Schema,
    qualityFlags: z.array(z.enum(['direct', 'complete', 'ambiguous', 'interrupted'])),
    safetyStatus: z.enum(['usable', 'sanitized', 'blocked']),
    blockedReason: z.string().trim().min(1).max(2_000).optional(),
    supersedes: z.array(IdentifierSchema),
    extractorVersion: IdentifierSchema,
    extractedAt: z.iso.datetime({ offset: true }),
    status: z.enum(['active', 'superseded', 'retracted']),
  })
  .superRefine((evidence, context) => {
    if (evidence.safetyStatus === 'blocked' && evidence.blockedReason === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['blockedReason'],
        message: 'blocked_reason_required',
      });
    }
  });

export const ProfileEvidenceCheckpointKindSchema = z.enum([
  'authoring_baseline',
  'authoring_candidate_confirmed',
  'teaching_session_closed',
  'supplementary_session_closed',
  'stage_review_finalized',
  'lesson_review_finalized',
  'course_review_finalized',
  'explicit_profile_refresh',
]);

export const ProfileEvidenceCandidateKindSchema = z.enum([
  'durable_preference',
  'durable_fact',
  'learning_behavior',
  'thinking_behavior',
]);

export const ProfileEvidenceExpiryPolicySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('until_corrected') }),
  z.strictObject({ kind: z.literal('window_bound'), expiresAt: z.iso.datetime({ offset: true }) }),
  z.strictObject({ kind: z.literal('review_after'), reviewAt: z.iso.datetime({ offset: true }) }),
]);

/**
 * AI-extracted evidence is deliberately candidate-only. It can be consumed as
 * analytical evidence, but it cannot represent a confirmed global-profile fact.
 */
export const ProfileEvidenceCandidateGovernanceSchema = z.strictObject({
  schemaVersion: z.literal(1),
  promotionState: z.literal('candidate_only'),
  candidateKind: ProfileEvidenceCandidateKindSchema,
  label: z.string().trim().min(1).max(500),
  explicitness: z.enum(['user_declared', 'ai_observed']),
  checkpointId: IdentifierSchema,
  checkpointIds: z.array(IdentifierSchema).min(1),
  checkpointKind: ProfileEvidenceCheckpointKindSchema,
  sourceType: z.enum(['outline', 'lesson', 'supplementary', 'review']),
  courseContext: z.string().trim().min(1).max(2_000).optional(),
  lessonContext: z.string().trim().min(1).max(2_000).optional(),
  confidence: z.number().min(0).max(1),
  observedCount: z.number().int().positive(),
  firstObservedAt: z.iso.datetime({ offset: true }),
  lastObservedAt: z.iso.datetime({ offset: true }),
  sourceSnapshotHash: Sha256Schema,
  sourceSnapshotHashes: z.array(Sha256Schema).min(1),
  observationKeys: z.array(Sha256Schema).min(1),
  qualityFlags: z.array(z.enum(['direct', 'complete', 'ambiguous', 'interrupted'])),
  limitations: z.array(z.string().trim().min(1).max(2_000)),
  safetyStatus: z.enum(['usable', 'sanitized', 'blocked']),
  blockedReason: z.string().trim().min(1).max(2_000).optional(),
  contradictionEvidenceIds: z.array(IdentifierSchema),
  expiryPolicy: ProfileEvidenceExpiryPolicySchema,
  semanticKey: Sha256Schema,
  supersedes: z.array(IdentifierSchema),
  analyzerVersion: IdentifierSchema,
  extractedAt: z.iso.datetime({ offset: true }),
});

export const GovernedProfileEvidenceCandidateSchema = z
  .strictObject({
    evidenceId: IdentifierSchema,
    claimDimension: z
      .string()
      .trim()
      .min(3)
      .max(500)
      .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/u),
    summary: z.string().trim().min(1).max(20_000),
    sourceRefs: z.array(SourceRefSchema).min(1),
    sourceGroupId: IdentifierSchema,
    dependentSourceGroupIds: z.array(IdentifierSchema),
    extractorVersion: IdentifierSchema,
    status: z.enum(['active', 'superseded', 'retracted']),
    ...ProfileEvidenceCandidateGovernanceSchema.shape,
  })
  .superRefine((candidate, context) => {
    if (candidate.safetyStatus === 'blocked' && candidate.blockedReason === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['blockedReason'],
        message: 'blocked_reason_required',
      });
    }
    if (Date.parse(candidate.firstObservedAt) > Date.parse(candidate.lastObservedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['firstObservedAt'],
        message: 'observed_range_invalid',
      });
    }
    if (!candidate.checkpointIds.includes(candidate.checkpointId)) {
      context.addIssue({
        code: 'custom',
        path: ['checkpointIds'],
        message: 'current_checkpoint_missing',
      });
    }
    if (!candidate.sourceSnapshotHashes.includes(candidate.sourceSnapshotHash)) {
      context.addIssue({
        code: 'custom',
        path: ['sourceSnapshotHashes'],
        message: 'current_snapshot_missing',
      });
    }
  });

export const GlobalUserProfileSnapshotSchema = z.strictObject({
  profileVersion: z.number().int().nonnegative(),
  statisticsSnapshotRef: SourceRefSchema,
  activeEvidenceIds: z.array(IdentifierSchema),
  artifactIndexRefs: z.array(SourceRefSchema),
  evidenceCursor: IdentifierSchema.optional(),
  completeness: z.enum(['insufficient', 'limited', 'complete']),
  backlogCount: z.number().int().nonnegative(),
  sourceSnapshotHash: Sha256Schema,
  createdAt: z.iso.datetime({ offset: true }),
});

export const UserProfileCheckpointManifestSchema = z.strictObject({
  checkpointId: IdentifierSchema,
  checkpointReason: z.union([
    z.enum(['manual_pause', 'evidenced_abandon', 'lesson_closure']),
    ProfileEvidenceCheckpointKindSchema,
  ]),
  sourceSnapshotHash: Sha256Schema,
  teachingSnapshotRef: SourceRefSchema,
  reviewRef: SourceRefSchema.optional(),
  sourceGroupId: IdentifierSchema,
  dependentSourceGroupIds: z.array(IdentifierSchema),
  completeness: z.enum(['complete', 'partial']),
});

export type UserProfileEvidence = Readonly<z.infer<typeof UserProfileEvidenceSchema>>;
export type ProfileEvidenceCheckpointKind = z.infer<typeof ProfileEvidenceCheckpointKindSchema>;
export type ProfileEvidenceCandidateKind = z.infer<typeof ProfileEvidenceCandidateKindSchema>;
export type ProfileEvidenceExpiryPolicy = Readonly<
  z.infer<typeof ProfileEvidenceExpiryPolicySchema>
>;
export type ProfileEvidenceCandidateGovernance = Readonly<
  z.infer<typeof ProfileEvidenceCandidateGovernanceSchema>
>;
export type GovernedProfileEvidenceCandidate = Readonly<
  z.infer<typeof GovernedProfileEvidenceCandidateSchema>
>;
export type ReasoningElicitation = z.infer<typeof ReasoningElicitationSchema>;
export type ReasoningBehaviorEpisode = Readonly<z.infer<typeof ReasoningBehaviorEpisodeSchema>>;
export type ReasoningDimensionDefinition = Readonly<
  z.infer<typeof ReasoningDimensionDefinitionSchema>
>;
export type ReasoningBehaviorClassification = Readonly<
  z.infer<typeof ReasoningBehaviorClassificationSchema>
>;
export type ReasoningAnalysisFilter = Readonly<z.infer<typeof ReasoningAnalysisFilterSchema>>;
export type ReasoningBehaviorAnalysisSnapshot = Readonly<
  z.infer<typeof ReasoningBehaviorAnalysisSnapshotSchema>
>;
export type GlobalUserProfileSnapshot = Readonly<z.infer<typeof GlobalUserProfileSnapshotSchema>>;
export type UserProfileCheckpointManifest = Readonly<
  z.infer<typeof UserProfileCheckpointManifestSchema>
>;
