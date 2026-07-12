import { z } from 'zod';

import type { CandidateEvidence } from '../../profile-evidence/interface.js';
import type { PortraitClaim, PortraitInputManifest } from '../interface.js';
import { isCompositeEligible } from './evidence-policy.js';

type PortraitValidationCode =
  | 'portrait_output_invalid'
  | 'portrait_evidence_outside_manifest'
  | 'portrait_claim_not_composite'
  | 'portrait_markdown_unsafe';

export class PortraitValidationError extends Error {
  constructor(readonly code: PortraitValidationCode) {
    super(code);
    this.name = 'PortraitValidationError';
  }
}

const ClaimSchema = z.strictObject({
  claimId: z.string().min(1).max(200),
  markdown: z.string().trim().min(1).max(20_000),
  evidenceIds: z.array(z.string().min(1)).min(2),
  confidence: z.number().min(0).max(1),
  limitations: z.array(z.string().trim().min(1).max(1_000)).min(1),
  counterEvidenceChecked: z.literal(true),
});

const OutputSchema = z.strictObject({
  title: z.string().trim().min(1).max(500),
  summary: z.string().trim().min(1).max(5_000),
  claims: z.array(ClaimSchema).max(50),
});

function safeMarkdown(value: string): boolean {
  return !/<\s*(script|iframe|object)|javascript:|onerror\s*=/i.test(value);
}

export function validatePortraitOutput(input: {
  output: unknown;
  manifest: PortraitInputManifest;
  evidence: readonly CandidateEvidence[];
}): Readonly<{ title: string; summary: string; claims: readonly PortraitClaim[] }> {
  const parsed = OutputSchema.safeParse(input.output);
  if (!parsed.success) throw new PortraitValidationError('portrait_output_invalid');
  if (!safeMarkdown(parsed.data.title) || !safeMarkdown(parsed.data.summary)) {
    throw new PortraitValidationError('portrait_markdown_unsafe');
  }
  const manifestIds = new Set(input.manifest.includedEvidenceIds);
  const evidenceById = new Map(
    input.evidence.map((candidate) => [candidate.evidenceId, candidate]),
  );
  const claimIds = new Set<string>();
  for (const claim of parsed.data.claims) {
    if (claimIds.has(claim.claimId)) throw new PortraitValidationError('portrait_output_invalid');
    claimIds.add(claim.claimId);
    if (new Set(claim.evidenceIds).size !== claim.evidenceIds.length) {
      throw new PortraitValidationError('portrait_output_invalid');
    }
    if (!safeMarkdown(claim.markdown))
      throw new PortraitValidationError('portrait_markdown_unsafe');
    const sources: CandidateEvidence[] = [];
    for (const evidenceId of claim.evidenceIds) {
      if (!manifestIds.has(evidenceId)) {
        throw new PortraitValidationError('portrait_evidence_outside_manifest');
      }
      const candidate = evidenceById.get(evidenceId);
      if (candidate === undefined || candidate.status !== 'active') {
        throw new PortraitValidationError('portrait_evidence_outside_manifest');
      }
      sources.push(candidate);
    }
    if (!isCompositeEligible(sources)) {
      throw new PortraitValidationError('portrait_claim_not_composite');
    }
  }
  return parsed.data;
}
