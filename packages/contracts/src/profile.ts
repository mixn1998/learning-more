import { z } from 'zod';

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

export type GlobalLearningProfile = Readonly<z.infer<typeof GlobalLearningProfileSchema>>;
