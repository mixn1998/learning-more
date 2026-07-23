import type { LearningFact, ReadModelStatus } from '../../interface.js';

export function compareFacts(left: LearningFact, right: LearningFact): number {
  return left.occurredAt === right.occurredAt
    ? left.factId.localeCompare(right.factId)
    : left.occurredAt.localeCompare(right.occurredAt);
}

export function createFactAccumulator() {
  const facts = new Map<string, LearningFact>();
  return {
    apply(batch: readonly LearningFact[]) {
      for (const fact of batch) facts.set(fact.factId, structuredClone(fact));
    },
    facts: () => [...facts.values()].sort(compareFacts),
  };
}

export function status(facts: readonly LearningFact[]): ReadModelStatus {
  const last = facts.at(-1);
  return {
    ...(last === undefined ? {} : { asOfEventId: last.sourceEventId }),
    projectionVersion: 1,
    freshness: 'current',
  };
}

export function localDate(instant: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(instant));
  const value = (type: 'year' | 'month' | 'day') => parts.find((part) => part.type === type)!.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export function isoWeek(localDateValue: string): string {
  const [year, month, day] = localDateValue.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - weekday + 3);
  const weekYear = date.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(weekYear, 0, 4));
  const firstWeekday = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstWeekday + 3);
  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / 604_800_000);
  return `${weekYear}-W${String(week).padStart(2, '0')}`;
}

export function actualSeconds(fact: LearningFact): number {
  const value = fact.payload.actualSeconds;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}
