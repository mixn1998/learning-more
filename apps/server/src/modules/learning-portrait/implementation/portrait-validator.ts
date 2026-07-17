import { z } from 'zod';

import type { CandidateEvidence } from '../../profile-evidence/interface.js';
import type { PortraitClaim, PortraitInputManifest } from '../interface.js';
import { isCompositeEligible } from './evidence-policy.js';

type PortraitValidationCode =
  | 'portrait_output_invalid'
  | 'portrait_evidence_outside_manifest'
  | 'portrait_claim_not_composite'
  | 'portrait_markdown_unsafe'
  | 'portrait_user_facing_language_invalid';

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

const INTERNAL_PORTRAIT_LANGUAGE =
  /reasoning(?:[-_][a-z0-9@]+)?|claimDimension|sourceGroup|extractorVersion|independentSourceGroup|冻结证据|独立学习会话|结构化推理|依赖链追踪|跨期权衡|链式可行性|分析粒度|选项价值|认知迁移|复合(?:行为)?证据|独立来源组|候选证据|证据投影|分析快照|置信度|分析器版本|(?:行为|思维|分析|抽象|全局)维度/iu;

const GENERIC_PORTRAIT_TITLE =
  /^(?:学习画像|当前学习画像|近期学习观察|复合证据观察|你在学习中的一个做法)$/u;

function usesInternalPortraitLanguage(value: string): boolean {
  return INTERNAL_PORTRAIT_LANGUAGE.test(value);
}

function containsSimplifiedChineseCopy(value: string): boolean {
  return /\p{Script=Han}/u.test(value);
}

function portraitClaimHeading(markdown: string): string | undefined {
  return /^###\s+(你[^\r\n]+)(?:\r?\n|$)/u.exec(markdown.trim())?.[1]?.trim();
}

function hasLearnerFacingOverview(title: string, summary: string): boolean {
  return (
    title.startsWith('你') &&
    Array.from(title).length <= 30 &&
    !GENERIC_PORTRAIT_TITLE.test(title) &&
    !/(?:学习)?画像|观察|洞察|证据|推理|分析/u.test(title) &&
    containsSimplifiedChineseCopy(title) &&
    summary.includes('你') &&
    containsSimplifiedChineseCopy(summary) &&
    Array.from(summary).length <= 240
  );
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
  if (
    parsed.data.claims.length > 0 &&
    (!hasLearnerFacingOverview(parsed.data.title, parsed.data.summary) ||
      usesInternalPortraitLanguage(parsed.data.title) ||
      usesInternalPortraitLanguage(parsed.data.summary))
  ) {
    throw new PortraitValidationError('portrait_user_facing_language_invalid');
  }
  const manifestIds = new Set(input.manifest.includedEvidenceIds);
  const evidenceById = new Map(
    input.evidence.map((candidate) => [candidate.evidenceId, candidate]),
  );
  const claimIds = new Set<string>();
  const claimHeadings = new Set<string>();
  for (const claim of parsed.data.claims) {
    if (claimIds.has(claim.claimId)) throw new PortraitValidationError('portrait_output_invalid');
    claimIds.add(claim.claimId);
    if (new Set(claim.evidenceIds).size !== claim.evidenceIds.length) {
      throw new PortraitValidationError('portrait_output_invalid');
    }
    if (!safeMarkdown(claim.markdown))
      throw new PortraitValidationError('portrait_markdown_unsafe');
    if (
      usesInternalPortraitLanguage(claim.markdown) ||
      !containsSimplifiedChineseCopy(claim.markdown) ||
      claim.limitations.some(
        (limitation) =>
          usesInternalPortraitLanguage(limitation) || !containsSimplifiedChineseCopy(limitation),
      )
    ) {
      throw new PortraitValidationError('portrait_user_facing_language_invalid');
    }
    const heading = portraitClaimHeading(claim.markdown);
    if (
      heading === undefined ||
      GENERIC_PORTRAIT_TITLE.test(heading) ||
      claimHeadings.has(heading)
    ) {
      throw new PortraitValidationError('portrait_user_facing_language_invalid');
    }
    claimHeadings.add(heading);
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
