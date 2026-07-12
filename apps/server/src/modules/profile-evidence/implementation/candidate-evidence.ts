import { z } from 'zod';

import { DataKeySchema } from '@learning-more/contracts';

import type { LearningFactType } from '../../learning-facts/interface.js';
import type { CandidateEvidence, EvidenceSourceGroup } from '../interface.js';

const FACT_TYPES = [
  'LessonStartedFact',
  'LessonPausedFact',
  'LessonAbandonedFact',
  'LessonRestoredFact',
  'LessonCompletedFact',
  'CourseCreatedFact',
  'CourseClosedFact',
  'ReviewFinalizedFact',
  'CourseReviewFinalizedFact',
  'ScheduleConfirmedFact',
] as const satisfies readonly LearningFactType[];

export const EVIDENCE_FACT_POLICY: Readonly<
  Record<EvidenceSourceGroup, readonly LearningFactType[]>
> = {
  behavior: ['LessonStartedFact', 'LessonPausedFact', 'LessonAbandonedFact', 'LessonRestoredFact'],
  outcome: ['LessonCompletedFact', 'CourseCreatedFact', 'CourseClosedFact'],
  reflection: ['ReviewFinalizedFact', 'CourseReviewFinalizedFact'],
  planning: ['ScheduleConfirmedFact'],
  review: ['ReviewFinalizedFact', 'CourseReviewFinalizedFact'],
};

const SourceRefSchema = z
  .string()
  .min(1)
  .max(500)
  .regex(/^(fact|message|review|course-review|outline|supplementary):[A-Za-z0-9._:-]+$/);

export const CandidateEvidenceSchema = z.strictObject({
  evidenceId: z.string().min(1).max(200),
  claimDimension: z
    .string()
    .min(3)
    .max(200)
    .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/),
  summary: z.string().trim().min(8).max(1_000),
  sourceGroup: z.enum(['behavior', 'outcome', 'reflection', 'planning', 'review']),
  sourceGroupId: z.string().min(1).max(300),
  dependentSourceGroupIds: z.array(z.string().min(1).max(300)),
  sourceFactType: z.enum(FACT_TYPES).optional(),
  sourceRefs: z.array(SourceRefSchema).min(1),
  dataKeys: z.array(DataKeySchema).min(1),
  observedAt: z.iso.datetime({ offset: true }),
  strength: z.strictObject({
    score: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    rationale: z.string().trim().min(8).max(500),
  }),
  polarity: z.enum(['supporting', 'limiting', 'contradicting']),
  extractorVersion: z.string().min(1).max(100),
  dedupKey: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum(['active', 'superseded', 'retracted']),
  resourceVersion: z.number().int().nonnegative(),
});

export function parseCandidateEvidence(input: unknown, now: Date): CandidateEvidence {
  const parsed = CandidateEvidenceSchema.parse(input);
  if (Date.parse(parsed.observedAt) > now.getTime()) throw new Error('evidence_observed_in_future');
  if (
    parsed.sourceFactType !== undefined &&
    !EVIDENCE_FACT_POLICY[parsed.sourceGroup].includes(parsed.sourceFactType)
  ) {
    throw new Error('evidence_source_fact_not_allowed');
  }
  if (new Set(parsed.sourceRefs).size !== parsed.sourceRefs.length) {
    throw new Error('evidence_source_ref_duplicate');
  }
  if (new Set(parsed.dependentSourceGroupIds).size !== parsed.dependentSourceGroupIds.length) {
    throw new Error('evidence_source_group_dependency_duplicate');
  }
  if (parsed.dependentSourceGroupIds.includes(parsed.sourceGroupId)) {
    throw new Error('evidence_source_group_self_dependency');
  }
  const { sourceFactType, ...required } = parsed;
  return {
    ...required,
    ...(sourceFactType === undefined ? {} : { sourceFactType }),
  };
}

export function supersedeCandidateEvidence(
  previous: CandidateEvidence,
  replacement: CandidateEvidence,
): Readonly<{ previous: CandidateEvidence; replacement: CandidateEvidence }> {
  if (previous.extractorVersion === replacement.extractorVersion) {
    throw new Error('extractor_version_must_change');
  }
  if (
    previous.claimDimension !== replacement.claimDimension ||
    previous.sourceGroupId !== replacement.sourceGroupId
  ) {
    throw new Error('evidence_supersede_scope_mismatch');
  }
  if (previous.status !== 'active' || replacement.status !== 'active') {
    throw new Error('evidence_supersede_status_invalid');
  }
  return { previous: { ...previous, status: 'superseded' }, replacement };
}
