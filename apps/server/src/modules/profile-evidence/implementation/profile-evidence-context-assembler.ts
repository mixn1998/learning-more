import { createHash } from 'node:crypto';

import type { ProfileEvidenceCheckpointInput } from '../model/profile-evidence-candidate.js';
import { ProfileEvidenceCheckpointInputSchema } from '../model/profile-evidence-candidate.js';

const TOTAL_EXCERPT_LIMIT = 40_000;

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function sanitizeExcerpt(value: string): string {
  return value
    .replaceAll('\u0000', '')
    .replaceAll(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/gu, '[已移除邮箱]')
    .replaceAll(/(?<!\d)1[3-9]\d{9}(?!\d)/gu, '[已移除手机号]')
    .replaceAll(/(?:api[_-]?key|access[_-]?token|password)\s*[:=]\s*\S+/giu, '[已移除凭据]')
    .trim();
}

export type AssembledProfileEvidenceContext = Readonly<{
  checkpoint: ProfileEvidenceCheckpointInput;
  sourceSnapshotHash: string;
}>;

export function assembleProfileEvidenceContext(input: unknown): AssembledProfileEvidenceContext {
  const parsed = ProfileEvidenceCheckpointInputSchema.parse(input);
  if (new Set(parsed.dependentSourceGroupIds).size !== parsed.dependentSourceGroupIds.length) {
    throw new Error('profile_checkpoint_dependency_duplicate');
  }
  if (parsed.dependentSourceGroupIds.includes(parsed.sourceGroupId)) {
    throw new Error('profile_checkpoint_self_dependency');
  }
  const sources = parsed.sources.map((source) => ({
    ...source,
    excerpt: sanitizeExcerpt(source.excerpt),
  }));
  if (sources.some((source) => source.excerpt === '')) {
    throw new Error('profile_checkpoint_empty_after_sanitization');
  }
  if (new Set(sources.map((source) => source.sourceRef)).size !== sources.length) {
    throw new Error('profile_checkpoint_source_ref_duplicate');
  }
  if (
    sources.some(
      (source) =>
        source.sourceGroupId !== parsed.sourceGroupId || source.sourceType !== parsed.sourceType,
    )
  ) {
    throw new Error('profile_checkpoint_source_scope_mismatch');
  }
  const totalLength = sources.reduce((total, source) => total + source.excerpt.length, 0);
  if (totalLength > TOTAL_EXCERPT_LIMIT)
    throw new Error('profile_checkpoint_excerpt_budget_exceeded');
  const checkpoint = ProfileEvidenceCheckpointInputSchema.parse({ ...parsed, sources });
  const { existingCandidates, ...sourceSnapshot } = checkpoint;
  void existingCandidates;
  const sourceSnapshotHash = sha256(JSON.stringify(sourceSnapshot));
  return Object.freeze({ checkpoint: Object.freeze(checkpoint), sourceSnapshotHash });
}
