import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { CandidateEvidence } from '../../profile-evidence/interface.js';
import { packPortraitEvidence } from '../implementation/evidence-packer.js';

function evidence(
  id: string,
  dimension: string,
  groupId: string,
  overrides: Partial<CandidateEvidence> = {},
): CandidateEvidence {
  return {
    evidenceId: id,
    claimDimension: dimension,
    summary: `Neutral observation for ${id} with enough bounded context for audit.`,
    sourceGroup: 'behavior',
    sourceGroupId: groupId,
    dependentSourceGroupIds: [],
    sourceRefs: [`fact:fact_${id}`],
    dataKeys: ['lesson.lifecycle_status'],
    observedAt: '2026-07-10T00:00:00.000Z',
    strength: { score: 2, rationale: 'A committed fact with bounded local interpretation.' },
    polarity: 'supporting',
    extractorVersion: 'facts@1',
    dedupKey: id.padEnd(64, 'a').slice(0, 64),
    status: 'active',
    resourceVersion: 1,
    ...overrides,
  };
}

describe('EvidencePacker', () => {
  it('does not let one strong source masquerade as composite evidence', () => {
    const packed = packPortraitEvidence({
      evidence: [
        evidence('evidence_01', 'learning.follow_through', 'lesson:01', {
          strength: { score: 3, rationale: 'Strong but still only one bounded source instance.' },
        }),
      ],
      tokenBudget: 1_000,
      dimensionPriority: ['learning.follow_through'],
    });
    expect(packed.includedEvidenceIds).toEqual([]);
    expect(packed.excluded).toEqual([
      { evidenceId: 'evidence_01', reason: 'insufficient_composite_support' },
    ]);
  });

  it('is invariant to input order and keeps the documented sort order', () => {
    const input = [
      evidence('evidence_b', 'learning.follow_through', 'lesson:02'),
      evidence('evidence_a', 'learning.follow_through', 'lesson:01', {
        strength: { score: 3, rationale: 'A stronger committed observation in another lesson.' },
      }),
      evidence('evidence_d', 'learning.reflection', 'course:02'),
      evidence('evidence_c', 'learning.reflection', 'course:01'),
    ];
    const options = {
      tokenBudget: 2_000,
      dimensionPriority: ['learning.reflection', 'learning.follow_through'],
    };
    expect(packPortraitEvidence({ evidence: input, ...options })).toEqual(
      packPortraitEvidence({ evidence: [...input].reverse(), ...options }),
    );
    expect(
      packPortraitEvidence({ evidence: input, ...options }).includedEvidenceIds.slice(0, 2),
    ).toEqual(['evidence_c', 'evidence_d']);
  });

  it('preserves dimension and independent-source coverage before adding extras under budget', () => {
    const input = [
      evidence('a1', 'dimension.alpha', 'lesson:a1'),
      evidence('a2', 'dimension.alpha', 'lesson:a2'),
      evidence('a3', 'dimension.alpha', 'lesson:a3', { summary: 'x'.repeat(800) }),
      evidence('b1', 'dimension.beta', 'course:b1'),
      evidence('b2', 'dimension.beta', 'course:b2'),
      evidence('b3', 'dimension.beta', 'course:b3', { summary: 'y'.repeat(800) }),
    ];
    const packed = packPortraitEvidence({
      evidence: input,
      tokenBudget: 220,
      dimensionPriority: ['dimension.alpha', 'dimension.beta'],
    });
    expect(packed.estimatedTokens).toBeLessThanOrEqual(220);
    expect(packed.dimensionCoverage).toEqual([
      expect.objectContaining({ dimension: 'dimension.alpha', includedCount: 2 }),
      expect.objectContaining({ dimension: 'dimension.beta', includedCount: 2 }),
    ]);
    expect(packed.excluded).toEqual(
      expect.arrayContaining([
        { evidenceId: 'a3', reason: 'budget_exceeded' },
        { evidenceId: 'b3', reason: 'budget_exceeded' },
      ]),
    );
  });

  it('retains supporting and contradicting evidence together but excludes retracted evidence', () => {
    const packed = packPortraitEvidence({
      evidence: [
        evidence('support', 'learning.transfer', 'lesson:01'),
        evidence('contradict', 'learning.transfer', 'lesson:02', {
          polarity: 'contradicting',
        }),
        evidence('retracted', 'learning.transfer', 'lesson:03', { status: 'retracted' }),
      ],
      tokenBudget: 1_000,
      dimensionPriority: [],
    });
    expect(packed.includedEvidenceIds).toEqual(['contradict', 'support']);
    expect(packed.excluded).toContainEqual({
      evidenceId: 'retracted',
      reason: 'retracted',
    });
  });

  it('keeps IDs unique, deterministic, and inside budget over randomized sets', () => {
    fc.assert(
      fc.property(fc.uniqueArray(fc.integer({ min: 0, max: 30 }), { maxLength: 20 }), (values) => {
        const input = values.flatMap((value) => [
          evidence(`e${value}_a`, `dimension.${value % 3}`, `lesson:${value}:a`),
          evidence(`e${value}_b`, `dimension.${value % 3}`, `lesson:${value}:b`),
        ]);
        const options = { tokenBudget: 600, dimensionPriority: ['dimension.0'] };
        const left = packPortraitEvidence({ evidence: input, ...options });
        const right = packPortraitEvidence({ evidence: [...input].reverse(), ...options });
        expect(left).toEqual(right);
        expect(new Set(left.includedEvidenceIds).size).toBe(left.includedEvidenceIds.length);
        expect(left.estimatedTokens).toBeLessThanOrEqual(options.tokenBudget);
      }),
      { numRuns: 300 },
    );
  });
});
