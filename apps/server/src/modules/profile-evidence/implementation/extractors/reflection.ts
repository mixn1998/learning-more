import type { LearningFact } from '../../../learning-facts/interface.js';
import type { EvidenceDraft } from './index.js';

export function extractReflectionEvidence(fact: LearningFact): readonly EvidenceDraft[] {
  if (fact.factType !== 'ReviewFinalizedFact' && fact.factType !== 'CourseReviewFinalizedFact') {
    return [];
  }
  const dependentGroupId =
    fact.subjectRefs.lessonId === undefined
      ? `course:${fact.subjectRefs.courseId ?? 'unknown'}`
      : `lesson:${fact.subjectRefs.lessonId}`;
  return [
    {
      claimDimension: 'learning.reflection_artifact_available',
      summary: 'An immutable Review artifact is available for bounded reflective evidence.',
      sourceGroup: 'review',
      sourceGroupId: `review:${dependentGroupId}`,
      dependentSourceGroupIds: [dependentGroupId],
      sourceFactType: fact.factType,
      sourceRefs: [`fact:${fact.factId}`],
      dataKeys: fact.dataKeys,
      observedAt: fact.occurredAt,
      strength: {
        score: 2,
        rationale:
          'The Review is auditable but remains dependent on its underlying learning source.',
      },
      polarity: 'supporting',
    },
  ];
}
