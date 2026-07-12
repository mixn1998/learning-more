import type { LearningFact } from '../../../learning-facts/interface.js';
import type { EvidenceDraft } from './index.js';

function lessonGroup(fact: LearningFact): string {
  const lessonId = fact.subjectRefs.lessonId;
  if (lessonId === undefined) throw new Error('evidence_lesson_source_missing');
  return `lesson:${lessonId}`;
}

export function extractBehaviorEvidence(fact: LearningFact): readonly EvidenceDraft[] {
  if (fact.factType === 'LessonAbandonedFact') {
    return [
      {
        claimDimension: 'learning.lifecycle_follow_through',
        summary: 'This lesson was abandoned in the recorded learning context.',
        sourceGroup: 'behavior',
        sourceGroupId: lessonGroup(fact),
        dependentSourceGroupIds: [],
        sourceFactType: fact.factType,
        sourceRefs: [`fact:${fact.factId}`],
        dataKeys: fact.dataKeys,
        observedAt: fact.occurredAt,
        strength: {
          score: 1,
          rationale: 'A single abandon is a local lifecycle observation only.',
        },
        polarity: 'limiting',
      },
    ];
  }
  if (fact.factType === 'LessonRestoredFact') {
    return [
      {
        claimDimension: 'learning.lifecycle_follow_through',
        summary: 'This lesson was explicitly restored after an earlier abandon state.',
        sourceGroup: 'behavior',
        sourceGroupId: lessonGroup(fact),
        dependentSourceGroupIds: [],
        sourceFactType: fact.factType,
        sourceRefs: [`fact:${fact.factId}`],
        dataKeys: fact.dataKeys,
        observedAt: fact.occurredAt,
        strength: {
          score: 2,
          rationale: 'The restore is an explicit lifecycle action with a stable fact source.',
        },
        polarity: 'supporting',
      },
    ];
  }
  if (fact.factType === 'LessonPausedFact') {
    return [
      {
        claimDimension: 'learning.session_regulation',
        summary: 'This learning session was explicitly paused in its recorded context.',
        sourceGroup: 'behavior',
        sourceGroupId: lessonGroup(fact),
        dependentSourceGroupIds: [],
        sourceFactType: fact.factType,
        sourceRefs: [`fact:${fact.factId}`],
        dataKeys: fact.dataKeys,
        observedAt: fact.occurredAt,
        strength: {
          score: 1,
          rationale: 'A single pause cannot establish a stable global preference.',
        },
        polarity: 'supporting',
      },
    ];
  }
  return [];
}
