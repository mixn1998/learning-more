import { describe, expect, it } from 'vitest';

import type { LearningFact, LearningFactType } from '../../learning-facts/interface.js';
import type { CandidateEvidence } from '../interface.js';
import { createGlobalLearningProfileProjection } from '../implementation/profile-projection.js';

const window = { from: '2026-07-01T00:00:00.000Z', to: '2026-08-01T00:00:00.000Z' };

function fact(
  id: string,
  factType: LearningFactType,
  at: string,
  payload: Record<string, unknown> = {},
): LearningFact {
  return {
    factId: id,
    factType,
    subjectRefs: { courseId: 'course_01', lessonId: `lesson_${id}` },
    occurredAt: at,
    recordedAt: at,
    sourceEventId: `event_${id}`,
    dataKeys:
      factType === 'LessonCompletedFact'
        ? ['completion.actual_seconds', 'completion.local_date']
        : factType === 'LessonAbandonedFact'
          ? ['lesson.abandoned_at']
          : ['review.generated_at'],
    payload,
    schemaVersion: 1,
  };
}

function evidence(
  id: string,
  sourceGroup: CandidateEvidence['sourceGroup'],
  sourceGroupId: string,
  status: CandidateEvidence['status'] = 'active',
): CandidateEvidence {
  return {
    evidenceId: id,
    claimDimension: 'learning.local_observation',
    summary: 'A bounded and neutral observation from one recorded source.',
    sourceGroup,
    sourceGroupId,
    dependentSourceGroupIds: [],
    sourceRefs: [`fact:fact_${id}`],
    dataKeys: ['lesson.lifecycle_status'],
    observedAt: '2026-07-10T00:00:00.000Z',
    strength: {
      score: 1,
      rationale: 'One local observation cannot establish a stable preference.',
    },
    polarity: 'supporting',
    extractorVersion: 'facts@1',
    dedupKey: id.padEnd(64, 'a'),
    status,
    resourceVersion: 1,
  };
}

describe('GlobalLearningProfile projection', () => {
  it('returns an explicit insufficient empty profile without inferred traits', () => {
    const projection = createGlobalLearningProfileProjection({ timeZone: 'Asia/Shanghai', window });
    const profile = projection.view();
    expect(profile.sufficiency).toMatchObject({ status: 'insufficient', activeEvidenceCount: 0 });
    expect(profile.lifecycle.completionFraction).toEqual({ numerator: 0, denominator: 0 });
    expect(JSON.stringify(profile)).not.toMatch(/preference|personality|ability/i);
  });

  it('keeps one evidence local and only raises sufficiency across independent source groups', () => {
    const projection = createGlobalLearningProfileProjection({ timeZone: 'Asia/Shanghai', window });
    projection.applyEvidence([evidence('evidence_01', 'behavior', 'lesson:01')]);
    expect(projection.view().sufficiency.status).toBe('insufficient');
    projection.applyEvidence([evidence('evidence_02', 'outcome', 'lesson:02')]);
    expect(projection.view().sufficiency).toMatchObject({
      status: 'limited',
      activeEvidenceCount: 2,
      independentSourceGroupCount: 2,
    });
  });

  it('removes retracted evidence from current sufficiency while retaining audit counts', () => {
    const projection = createGlobalLearningProfileProjection({ timeZone: 'Asia/Shanghai', window });
    projection.applyEvidence([
      evidence('evidence_01', 'behavior', 'lesson:01'),
      evidence('evidence_02', 'outcome', 'lesson:02', 'retracted'),
    ]);
    expect(projection.view().sufficiency).toMatchObject({
      status: 'insufficient',
      activeEvidenceCount: 1,
      historicalEvidenceCount: 2,
    });
  });

  it('produces the same checksum incrementally and from zero with explicit windows and denominators', () => {
    const facts = [
      fact('01', 'LessonCompletedFact', '2026-07-01T16:30:00.000Z', {
        actualSeconds: 600,
        topicTags: ['probability'],
      }),
      fact('02', 'LessonAbandonedFact', '2026-07-31T23:00:00.000Z'),
      fact('outside', 'LessonCompletedFact', '2026-08-01T00:00:00.000Z', {
        actualSeconds: 900,
      }),
      fact('03', 'ReviewFinalizedFact', '2026-07-15T00:00:00.000Z'),
    ];
    const allEvidence = [
      evidence('evidence_01', 'behavior', 'lesson:01'),
      evidence('evidence_02', 'outcome', 'lesson:02'),
    ];
    const incremental = createGlobalLearningProfileProjection({
      timeZone: 'Asia/Shanghai',
      window,
    });
    incremental.applyFacts(facts.slice(0, 2));
    incremental.applyFacts(facts.slice(2));
    incremental.applyEvidence(allEvidence.slice(0, 1));
    incremental.applyEvidence(allEvidence.slice(1));
    const rebuilt = createGlobalLearningProfileProjection({ timeZone: 'Asia/Shanghai', window });
    rebuilt.applyFacts(facts);
    rebuilt.applyEvidence(allEvidence);
    expect(incremental.view().profileChecksum).toBe(rebuilt.view().profileChecksum);
    expect(rebuilt.view()).toMatchObject({
      learningVolume: { actualSeconds: 600, completedLessonCount: 1, sourceCount: 1 },
      lifecycle: {
        abandonedCount: 1,
        completionFraction: { numerator: 1, denominator: 2 },
      },
      reviewReflection: { finalizedReviewCount: 1 },
      topicCoverage: { topics: [{ topic: 'probability', completedLessonCount: 1 }] },
    });
    expect(rebuilt.view().dailySeries).toEqual([
      {
        localDate: '2026-07-02',
        actualSeconds: 600,
        completedLessonCount: 1,
      },
    ]);
  });
});
