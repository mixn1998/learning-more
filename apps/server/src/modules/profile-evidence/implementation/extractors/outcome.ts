import type { LearningFact } from '../../../learning-facts/interface.js';
import type { EvidenceDraft } from './index.js';

function sourceGroupId(fact: LearningFact): string {
  if (fact.subjectRefs.lessonId !== undefined) return `lesson:${fact.subjectRefs.lessonId}`;
  if (fact.subjectRefs.courseId !== undefined) return `course:${fact.subjectRefs.courseId}`;
  throw new Error('evidence_outcome_source_missing');
}

export function extractOutcomeEvidence(fact: LearningFact): readonly EvidenceDraft[] {
  if (fact.factType === 'LessonCompletedFact') {
    return [
      {
        claimDimension: 'learning.completion_outcome',
        summary: 'This lesson reached completed state after its final Review was committed.',
        sourceGroup: 'outcome',
        sourceGroupId: sourceGroupId(fact),
        dependentSourceGroupIds: [],
        sourceFactType: fact.factType,
        sourceRefs: [`fact:${fact.factId}`],
        dataKeys: fact.dataKeys,
        observedAt: fact.occurredAt,
        strength: {
          score: 2,
          rationale: 'Completion is a committed outcome fact, not an inferred ability label.',
        },
        polarity: 'supporting',
      },
    ];
  }
  if (fact.factType === 'CourseClosedFact') {
    return [
      {
        claimDimension: 'learning.course_closure_outcome',
        summary: 'This course was closed with its immutable course Review boundary.',
        sourceGroup: 'outcome',
        sourceGroupId: sourceGroupId(fact),
        dependentSourceGroupIds: [],
        sourceFactType: fact.factType,
        sourceRefs: [`fact:${fact.factId}`],
        dataKeys: fact.dataKeys,
        observedAt: fact.occurredAt,
        strength: {
          score: 2,
          rationale: 'Course closure is a committed outcome with an auditable source fact.',
        },
        polarity: 'supporting',
      },
    ];
  }
  return [];
}
