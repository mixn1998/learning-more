import type { DataKey } from '@learning-more/contracts';

import { checksumJson } from '../../../persistence/json-codec.js';
import type { LearningFact } from '../../learning-facts/interface.js';
import type { CandidateEvidence } from '../interface.js';
import {
  type GlobalLearningProfile,
  type ProfileWindow,
  validateProfileWindow,
} from './global-learning-profile.js';

function factOrder(left: LearningFact, right: LearningFact): number {
  return left.occurredAt === right.occurredAt
    ? left.factId.localeCompare(right.factId)
    : left.occurredAt.localeCompare(right.occurredAt);
}

function inWindow(value: string, window: ProfileWindow): boolean {
  return value >= window.from && value < window.to;
}

function localDate(value: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value));
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function withFactCursor<T extends object>(value: T, asOfFactId: string | undefined) {
  return { ...value, ...(asOfFactId === undefined ? {} : { asOfFactId }) };
}

export function createGlobalLearningProfileProjection(options: {
  timeZone: string;
  window: ProfileWindow;
}) {
  validateProfileWindow(options.window);
  const facts = new Map<string, LearningFact>();
  const evidence = new Map<string, CandidateEvidence>();

  return {
    applyFacts(batch: readonly LearningFact[]) {
      for (const fact of batch) facts.set(fact.factId, structuredClone(fact));
    },
    applyEvidence(batch: readonly CandidateEvidence[]) {
      for (const candidate of batch) {
        const current = evidence.get(candidate.evidenceId);
        if (current === undefined || candidate.resourceVersion >= current.resourceVersion) {
          evidence.set(candidate.evidenceId, structuredClone(candidate));
        }
      }
    },
    view(): GlobalLearningProfile {
      const windowFacts = [...facts.values()]
        .filter((fact) => inWindow(fact.occurredAt, options.window))
        .sort(factOrder);
      const asOfFactId = windowFacts.at(-1)?.factId;
      const completed = windowFacts.filter((fact) => fact.factType === 'LessonCompletedFact');
      const abandoned = windowFacts.filter((fact) => fact.factType === 'LessonAbandonedFact');
      const restored = windowFacts.filter((fact) => fact.factType === 'LessonRestoredFact');
      const reviews = windowFacts.filter(
        (fact) =>
          fact.factType === 'ReviewFinalizedFact' || fact.factType === 'CourseReviewFinalizedFact',
      );
      const schedules = windowFacts.filter((fact) => fact.factType === 'ScheduleConfirmedFact');
      const actualSeconds = completed.reduce(
        (total, fact) =>
          total + (typeof fact.payload.actualSeconds === 'number' ? fact.payload.actualSeconds : 0),
        0,
      );
      const daily = new Map<string, { actualSeconds: number; completedLessonCount: number }>();
      const topics = new Map<string, number>();
      for (const fact of completed) {
        const day = localDate(fact.occurredAt, options.timeZone);
        const current = daily.get(day) ?? { actualSeconds: 0, completedLessonCount: 0 };
        current.actualSeconds +=
          typeof fact.payload.actualSeconds === 'number' ? fact.payload.actualSeconds : 0;
        current.completedLessonCount += 1;
        daily.set(day, current);
        if (Array.isArray(fact.payload.topicTags)) {
          for (const topic of fact.payload.topicTags) {
            if (typeof topic === 'string') topics.set(topic, (topics.get(topic) ?? 0) + 1);
          }
        }
      }

      const windowEvidence = [...evidence.values()]
        .filter((candidate) => inWindow(candidate.observedAt, options.window))
        .sort((left, right) => left.evidenceId.localeCompare(right.evidenceId));
      const activeEvidence = windowEvidence.filter((candidate) => candidate.status === 'active');
      const independentSourceGroupCount = new Set(
        activeEvidence.map((candidate) => candidate.sourceGroupId),
      ).size;
      const sourceCategoryCount = new Set(activeEvidence.map((candidate) => candidate.sourceGroup))
        .size;
      const sufficiencyStatus: GlobalLearningProfile['sufficiency']['status'] =
        independentSourceGroupCount < 2 || sourceCategoryCount < 2
          ? 'insufficient'
          : independentSourceGroupCount >= 4 && sourceCategoryCount >= 3
            ? 'sufficient'
            : 'limited';
      const observed = [
        ...windowFacts.map((fact) => fact.occurredAt),
        ...windowEvidence.map((candidate) => candidate.observedAt),
      ].sort();
      const dataKeys = (items: readonly LearningFact[]): readonly DataKey[] =>
        [...new Set(items.flatMap((item) => item.dataKeys))].sort();
      const base = {
        profileSchemaVersion: 1,
        metricDefinitionVersion: 1,
        timezone: options.timeZone,
        window: options.window,
        ...(asOfFactId === undefined ? {} : { asOfFactId }),
        learningVolume: withFactCursor(
          {
            actualSeconds,
            completedLessonCount: completed.length,
            dataKeys: dataKeys(completed),
            sourceCount: completed.length,
          },
          asOfFactId,
        ),
        lifecycle: withFactCursor(
          {
            completedCount: completed.length,
            abandonedCount: abandoned.length,
            restoredCount: restored.length,
            completionFraction: {
              numerator: completed.length,
              denominator: completed.length + abandoned.length,
            },
            dataKeys: dataKeys([...completed, ...abandoned, ...restored]),
            sourceCount: completed.length + abandoned.length + restored.length,
          },
          asOfFactId,
        ),
        reviewReflection: withFactCursor(
          {
            finalizedReviewCount: reviews.length,
            dataKeys: dataKeys(reviews),
            sourceCount: reviews.length,
          },
          asOfFactId,
        ),
        planning: withFactCursor(
          {
            confirmedScheduleCount: schedules.length,
            dataKeys: dataKeys(schedules),
            sourceCount: schedules.length,
          },
          asOfFactId,
        ),
        topicCoverage: withFactCursor(
          {
            topics: [...topics.entries()]
              .sort(([left], [right]) => left.localeCompare(right))
              .map(([topic, completedLessonCount]) => ({ topic, completedLessonCount })),
            dataKeys: dataKeys(completed),
            sourceCount: completed.length,
          },
          asOfFactId,
        ),
        dailySeries: [...daily.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([day, value]) => ({ localDate: day, ...value })),
        sufficiency: {
          status: sufficiencyStatus,
          activeEvidenceCount: activeEvidence.length,
          historicalEvidenceCount: windowEvidence.length,
          independentSourceGroupCount,
          sourceCategoryCount,
          ...(activeEvidence.at(-1)?.evidenceId === undefined
            ? {}
            : { asOfEvidenceId: activeEvidence.at(-1)!.evidenceId }),
        },
        ...(observed.length === 0
          ? {}
          : { observedRange: { first: observed[0]!, last: observed.at(-1)! } }),
      };
      return { ...base, profileChecksum: checksumJson(base) };
    },
  };
}
