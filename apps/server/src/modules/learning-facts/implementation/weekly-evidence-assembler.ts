import type { LearningFact } from '../interface.js';
import type { WeeklyFactSnapshotEntry } from '../ports/weekly-report-repository.js';
import { localDate } from './projections/shared.js';

function factEntry(fact: LearningFact): WeeklyFactSnapshotEntry {
  return {
    factId: fact.factId,
    sourceRef: `fact:${fact.factId}`,
    kind: 'learning-session',
    occurredAt: fact.occurredAt,
    summary: 'LessonCompletedFact',
    ...(fact.subjectRefs.courseId === undefined ? {} : { courseId: fact.subjectRefs.courseId }),
    ...(fact.subjectRefs.lessonId === undefined ? {} : { lessonId: fact.subjectRefs.lessonId }),
    actualSeconds: typeof fact.payload.actualSeconds === 'number' ? fact.payload.actualSeconds : 0,
    ...(typeof fact.payload.disciplineTag === 'string'
      ? { disciplineTag: fact.payload.disciplineTag }
      : {}),
    topicTags: Array.isArray(fact.payload.topicTags)
      ? fact.payload.topicTags.filter((value): value is string => typeof value === 'string')
      : [],
  };
}

export function assembleWeeklyEvidence(input: {
  facts: readonly LearningFact[];
  startLocalDate: string;
  endLocalDate: string;
  timeZone: string;
}): Readonly<{
  snapshot: readonly WeeklyFactSnapshotEntry[];
  exclusions: readonly string[];
  projectionCursor?: string;
}> {
  const snapshot: WeeklyFactSnapshotEntry[] = [];
  const exclusions: string[] = [];
  let projectionCursor: string | undefined;
  for (const fact of input.facts) {
    projectionCursor = fact.sourceEventId;
    if (fact.factType !== 'LessonCompletedFact') continue;
    const date = localDate(fact.occurredAt, input.timeZone);
    if (date < input.startLocalDate || date >= input.endLocalDate) {
      exclusions.push(`outside_window:fact:${fact.factId}`);
      continue;
    }
    snapshot.push(factEntry(fact));
  }
  const deduplicated = snapshot
    .filter(
      (entry, index, all) =>
        all.findIndex(
          (candidate) =>
            (candidate.sourceRef ?? candidate.factId) === (entry.sourceRef ?? entry.factId),
        ) === index,
    )
    .sort((left, right) =>
      left.occurredAt === right.occurredAt
        ? (left.sourceRef ?? left.factId).localeCompare(right.sourceRef ?? right.factId)
        : left.occurredAt.localeCompare(right.occurredAt),
    );
  return {
    snapshot: deduplicated,
    exclusions: exclusions.sort(),
    ...(projectionCursor === undefined ? {} : { projectionCursor }),
  };
}
