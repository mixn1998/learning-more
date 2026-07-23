import { z } from 'zod';

import {
  ReasoningBehaviorAnalysisSnapshotSchema,
  ReasoningDimensionDefinitionSchema,
} from './global-user-profile.js';

import { DataKeySchema } from './data-keys.js';

const FactCursorSchema = z.string().min(1).optional();
const ProfileMetricBaseSchema = z.strictObject({
  dataKeys: z.array(DataKeySchema),
  sourceCount: z.number().int().nonnegative(),
  asOfFactId: FactCursorSchema,
});
const FractionSchema = z.strictObject({
  numerator: z.number().int().nonnegative(),
  denominator: z.number().int().nonnegative(),
});

export const GlobalLearningProfileSchema = z.strictObject({
  profileSchemaVersion: z.number().int().positive(),
  metricDefinitionVersion: z.number().int().positive(),
  timezone: z.string().min(1),
  window: z.strictObject({
    from: z.iso.datetime({ offset: true }),
    to: z.iso.datetime({ offset: true }),
  }),
  asOfFactId: FactCursorSchema,
  learningVolume: ProfileMetricBaseSchema.extend({
    actualSeconds: z.number().nonnegative(),
    completedLessonCount: z.number().int().nonnegative(),
  }),
  lifecycle: ProfileMetricBaseSchema.extend({
    completedCount: z.number().int().nonnegative(),
    abandonedCount: z.number().int().nonnegative(),
    restoredCount: z.number().int().nonnegative(),
    completionFraction: FractionSchema,
  }),
  reviewReflection: ProfileMetricBaseSchema.extend({
    finalizedReviewCount: z.number().int().nonnegative(),
  }),
  planning: ProfileMetricBaseSchema.extend({
    confirmedScheduleCount: z.number().int().nonnegative(),
  }),
  interaction: ProfileMetricBaseSchema.extend({
    promptCount: z.number().int().nonnegative(),
    responseCount: z.number().int().nonnegative(),
    skipCount: z.number().int().nonnegative(),
    interactionLessonCount: z.number().int().nonnegative(),
    responseRate: FractionSchema,
  }),
  topicCoverage: ProfileMetricBaseSchema.extend({
    topics: z.array(
      z.strictObject({
        topic: z.string(),
        completedLessonCount: z.number().int().nonnegative(),
      }),
    ),
  }),
  dailySeries: z.array(
    z.strictObject({
      localDate: z.iso.date(),
      actualSeconds: z.number().nonnegative(),
      completedLessonCount: z.number().int().nonnegative(),
    }),
  ),
  exclusions: z.strictObject({
    outsideWindowFactCount: z.number().int().nonnegative(),
    retractedEvidenceCount: z.number().int().nonnegative(),
    supersededEvidenceCount: z.number().int().nonnegative(),
    telemetryDataKeyCount: z.number().int().nonnegative(),
  }),
  sufficiency: z.strictObject({
    status: z.enum(['insufficient', 'limited', 'sufficient']),
    activeEvidenceCount: z.number().int().nonnegative(),
    historicalEvidenceCount: z.number().int().nonnegative(),
    independentSourceGroupCount: z.number().int().nonnegative(),
    sourceCategoryCount: z.number().int().nonnegative(),
    asOfEvidenceId: z.string().min(1).optional(),
  }),
  observedRange: z
    .strictObject({
      first: z.iso.datetime({ offset: true }),
      last: z.iso.datetime({ offset: true }),
    })
    .optional(),
  profileChecksum: z.string().min(1),
});

export const PortraitEvidenceSchema = z.strictObject({
  evidenceId: z.string().min(1),
  summary: z.string(),
  sourceGroup: z.enum(['behavior', 'outcome', 'reflection', 'planning', 'review']),
  sourceGroupId: z.string().min(1),
  dependentSourceGroupIds: z.array(z.string()),
  observedAt: z.iso.datetime({ offset: true }),
  strength: z.strictObject({
    score: z.number().int().min(1).max(3),
    rationale: z.string(),
  }),
  polarity: z.enum(['supporting', 'limiting', 'contradicting']),
  status: z.enum(['active', 'superseded', 'retracted']),
});

export const PortraitEvidencePageSchema = z.strictObject({
  entries: z.array(PortraitEvidenceSchema),
  nextCursor: z.string().min(1).optional(),
});

export const PortraitClaimSchema = z.strictObject({
  claimId: z.string().min(1),
  semanticModeId: z.string().min(1).optional(),
  evidenceSessionCount: z.number().int().nonnegative().optional(),
  markdown: z.string(),
  evidenceIds: z.array(z.string().min(1)),
  confidence: z.number().min(0).max(1),
  limitations: z.array(z.string()),
  counterEvidenceChecked: z.literal(true),
});

export const PortraitReasoningBehaviorAnalysisSchema = z.strictObject({
  snapshot: ReasoningBehaviorAnalysisSnapshotSchema,
  dimensions: z.array(ReasoningDimensionDefinitionSchema),
});

export const PortraitVersionSchema = z.strictObject({
  versionId: z.string().min(1),
  manifestId: z.string().min(1),
  state: z.enum(['preparing', 'generating', 'failed', 'completed']),
  generationTaskId: z.string().min(1).optional(),
  title: z.string().optional(),
  summary: z.string().optional(),
  claims: z.array(PortraitClaimSchema),
  errorCode: z.string().min(1).optional(),
  draftArtifactRef: z.string().min(1).optional(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  completedAt: z.iso.datetime({ offset: true }).optional(),
  resourceVersion: z.number().int().nonnegative(),
  reasoningBehaviorAnalysis: PortraitReasoningBehaviorAnalysisSchema.optional(),
});

export const PortraitRefreshStatusSchema = z.strictObject({
  state: z.enum(['updating', 'failed']),
  errorCode: z.string().min(1).optional(),
  retryable: z.boolean().optional(),
  updatedAt: z.iso.datetime({ offset: true }),
});

export const PortraitCurrentSchema = z.union([PortraitVersionSchema, PortraitRefreshStatusSchema]);

export const PortraitRefreshRequestSchema = z.strictObject({
  tokenBudget: z.number().int().min(256).max(100_000).default(8_000),
});

export type GlobalLearningProfile = Readonly<z.infer<typeof GlobalLearningProfileSchema>>;
export type PortraitEvidence = Readonly<z.infer<typeof PortraitEvidenceSchema>>;
export type PortraitEvidencePage = Readonly<z.infer<typeof PortraitEvidencePageSchema>>;
export type PortraitClaim = Readonly<z.infer<typeof PortraitClaimSchema>>;
export type PortraitReasoningBehaviorAnalysis = Readonly<
  z.infer<typeof PortraitReasoningBehaviorAnalysisSchema>
>;
export type PortraitVersion = Readonly<z.infer<typeof PortraitVersionSchema>>;
export type PortraitRefreshStatus = Readonly<z.infer<typeof PortraitRefreshStatusSchema>>;
export type PortraitCurrent = Readonly<z.infer<typeof PortraitCurrentSchema>>;
export type PortraitRefreshRequest = Readonly<z.infer<typeof PortraitRefreshRequestSchema>>;
