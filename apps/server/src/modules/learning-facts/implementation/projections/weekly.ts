import type { ReadModelStatus } from '../../interface.js';
import { actualSeconds, createFactAccumulator, isoWeek, localDate, status } from './shared.js';

type WeeklySummary = Readonly<{
  isoWeek: string;
  timezone: string;
  actualSeconds: number;
  completedLessonCount: number;
  activeDayCount: number;
}>;

export type WeeklyView = ReadModelStatus & Readonly<{ weeks: readonly WeeklySummary[] }>;

export function createWeeklyProjection(timeZone: string) {
  const accumulator = createFactAccumulator();
  return {
    apply: accumulator.apply,
    view(): WeeklyView {
      const facts = accumulator.facts();
      const weeks = new Map<
        string,
        { actualSeconds: number; completedLessonCount: number; days: Set<string> }
      >();
      for (const fact of facts) {
        if (fact.factType !== 'LessonCompletedFact') continue;
        const date = localDate(fact.occurredAt, timeZone);
        const key = isoWeek(date);
        const current = weeks.get(key) ?? {
          actualSeconds: 0,
          completedLessonCount: 0,
          days: new Set<string>(),
        };
        current.actualSeconds += actualSeconds(fact);
        current.completedLessonCount += 1;
        current.days.add(date);
        weeks.set(key, current);
      }
      return {
        ...status(facts),
        weeks: [...weeks.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, value]) => ({
            isoWeek: key,
            timezone: timeZone,
            actualSeconds: value.actualSeconds,
            completedLessonCount: value.completedLessonCount,
            activeDayCount: value.days.size,
          })),
      };
    },
  };
}
