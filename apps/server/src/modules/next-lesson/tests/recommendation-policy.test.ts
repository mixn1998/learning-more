import { describe, expect, it } from 'vitest';

import { resolveNextLessonRecommendation } from '../implementation/recommendation-policy.js';

const baseInput = {
  courseId: 'course_01',
  trigger: 'lesson-completed' as const,
  completedSemanticKeys: ['foundation'],
  candidates: [
    {
      semanticKey: 'next',
      title: 'Next',
      objective: 'Continue',
      prerequisiteSemanticKeys: ['foundation'],
      estimatedMinutes: 20,
    },
  ],
};

describe('resolveNextLessonRecommendation', () => {
  it('preserves a still-valid eligible recommendation when AI is unavailable', async () => {
    const previousRecommendation = {
      versionId: 'version_previous',
      semanticKey: 'next',
      rankedSemanticKeys: ['next'],
      rationale: 'Still useful.',
      evidenceRefs: [],
      confidence: 0.7,
      expiresAt: '2026-07-20T00:00:00.000Z',
      sourceSnapshotHash: 'a'.repeat(64),
      status: 'current' as const,
      warnings: [],
    };
    await expect(
      resolveNextLessonRecommendation({
        input: { ...baseInput, previousRecommendation },
        recommender: { recommend: async () => Promise.reject(new Error('provider_down')) },
        now: () => new Date('2026-07-14T00:00:00.000Z'),
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        versionId: 'version_previous',
        status: 'current',
        warnings: ['ai_unavailable_preserved'],
      }),
    );
  });

  it('uses an explicit deterministic fallback and clears when no lesson is eligible', async () => {
    await expect(
      resolveNextLessonRecommendation({
        input: baseInput,
        recommender: { recommend: async () => Promise.reject(new Error('provider_down')) },
        now: () => new Date('2026-07-14T00:00:00.000Z'),
      }),
    ).resolves.toEqual(
      expect.objectContaining({ semanticKey: 'next', status: 'fallback', confidence: 0 }),
    );
    await expect(
      resolveNextLessonRecommendation({
        input: { ...baseInput, completedSemanticKeys: ['foundation', 'next'] },
      }),
    ).resolves.toBeUndefined();
  });
});
