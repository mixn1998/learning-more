import { describe, expect, it } from 'vitest';

import { assembleProfileEvidenceContext } from '../implementation/profile-evidence-context-assembler.js';

function checkpoint(existingCandidates: readonly Record<string, string>[]) {
  return {
    checkpointId: 'checkpoint_review_1',
    checkpointKind: 'lesson_review_finalized',
    sourceType: 'review',
    sourceGroupId: 'review:review_1',
    courseId: 'course_1',
    courseMode: 'standard',
    dependentSourceGroupIds: ['lesson:lesson_1:session:session_1'],
    completeness: 'complete',
    sources: [
      {
        sourceRef: 'review:review_1',
        sourceGroupId: 'review:review_1',
        sourceType: 'review',
        role: 'review',
        excerpt: '# Review',
        observedAt: '2026-07-17T10:00:00.000Z',
      },
    ],
    existingCandidates,
  };
}

describe('profile evidence context assembler', () => {
  it('keeps the source snapshot stable when only prior candidate context changes', () => {
    const withoutCandidates = assembleProfileEvidenceContext(checkpoint([]));
    const withCandidate = assembleProfileEvidenceContext(
      checkpoint([
        {
          evidenceId: 'evidence_1',
          semanticKey: 'a'.repeat(64),
          claimDimension: 'thinking.counterfactual',
          summary: 'prior context',
          sourceGroupId: 'review:older',
        },
      ]),
    );

    expect(withCandidate.sourceSnapshotHash).toBe(withoutCandidates.sourceSnapshotHash);
  });
});
