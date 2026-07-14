import { createHash } from 'node:crypto';

import {
  CourseModeSchema,
  ProfileEvidenceCandidateKindSchema,
  ProfileEvidenceCheckpointKindSchema,
  ProfileEvidenceExpiryPolicySchema,
} from '@learning-more/contracts';
import { z } from 'zod';

const SourceRefSchema = z
  .string()
  .trim()
  .min(1)
  .max(2_000)
  .regex(/^(message|review|course-review|outline|supplementary):[A-Za-z0-9._:-]+$/u);

export const ProfileEvidenceCheckpointSourceSchema = z.strictObject({
  sourceRef: SourceRefSchema,
  sourceGroupId: z.string().trim().min(1).max(500),
  sourceType: z.enum(['outline', 'lesson', 'supplementary', 'review']),
  role: z.enum(['user', 'assistant', 'observer', 'review']),
  excerpt: z.string().trim().min(1).max(4_000),
  observedAt: z.iso.datetime({ offset: true }),
});

export const ExistingProfileCandidateRefSchema = z.strictObject({
  evidenceId: z.string().trim().min(1).max(500),
  semanticKey: z.string().regex(/^[a-f0-9]{64}$/u),
  claimDimension: z.string().trim().min(3).max(500),
  summary: z.string().trim().min(1).max(2_000),
  sourceGroupId: z.string().trim().min(1).max(500),
});

export const ProfileEvidenceCheckpointInputSchema = z.strictObject({
  checkpointId: z.string().trim().min(1).max(500),
  checkpointKind: ProfileEvidenceCheckpointKindSchema,
  sourceType: z.enum(['outline', 'lesson', 'supplementary', 'review']),
  sourceGroupId: z.string().trim().min(1).max(500),
  courseId: z.string().trim().min(1).max(500).optional(),
  courseMode: CourseModeSchema.optional(),
  dependentSourceGroupIds: z.array(z.string().trim().min(1).max(500)),
  courseContext: z.string().trim().min(1).max(2_000).optional(),
  lessonContext: z.string().trim().min(1).max(2_000).optional(),
  completeness: z.enum(['complete', 'partial']),
  sources: z.array(ProfileEvidenceCheckpointSourceSchema).min(1).max(64),
  existingCandidates: z.array(ExistingProfileCandidateRefSchema).max(200),
});

export const ProfileEvidenceExtractionDraftSchema = z
  .strictObject({
    candidateKind: ProfileEvidenceCandidateKindSchema,
    claimDimension: z
      .string()
      .trim()
      .min(3)
      .max(500)
      .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/u),
    label: z.string().trim().min(1).max(500),
    summary: z.string().trim().min(1).max(10_000),
    explicitness: z.enum(['user_declared', 'ai_observed']),
    sourceRefs: z.array(SourceRefSchema).min(1),
    confidence: z.number().min(0).max(1),
    qualityFlags: z.array(z.enum(['direct', 'complete', 'ambiguous', 'interrupted'])),
    limitations: z.array(z.string().trim().min(1).max(2_000)),
    safetyStatus: z.enum(['usable', 'sanitized', 'blocked']),
    blockedReason: z.string().trim().min(1).max(2_000).optional(),
    polarity: z.enum(['supporting', 'limiting', 'contradicting']),
    contradictionEvidenceIds: z.array(z.string().trim().min(1).max(500)),
    expiryPolicy: ProfileEvidenceExpiryPolicySchema,
  })
  .superRefine((candidate, context) => {
    if (candidate.safetyStatus === 'blocked' && candidate.blockedReason === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['blockedReason'],
        message: 'blocked_reason_required',
      });
    }
  });

export type ProfileEvidenceCheckpointSource = Readonly<
  z.infer<typeof ProfileEvidenceCheckpointSourceSchema>
>;
export type ProfileEvidenceCheckpointInput = Readonly<
  z.infer<typeof ProfileEvidenceCheckpointInputSchema>
>;
export type ProfileEvidenceExtractionDraft = Readonly<
  z.infer<typeof ProfileEvidenceExtractionDraftSchema>
>;

export function profileEvidenceSemanticKey(
  draft: Pick<ProfileEvidenceExtractionDraft, 'candidateKind' | 'claimDimension' | 'label'>,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        candidateKind: draft.candidateKind,
        claimDimension: draft.claimDimension.toLowerCase(),
        label: draft.label.trim().toLocaleLowerCase('zh-CN'),
      }),
      'utf8',
    )
    .digest('hex');
}
