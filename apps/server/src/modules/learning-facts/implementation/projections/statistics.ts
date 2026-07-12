import type { ReadModelStatus } from '../../interface.js';
import { actualSeconds, createFactAccumulator, localDate, status } from './shared.js';

export type StatisticsView = ReadModelStatus &
  Readonly<{
    totalActualSeconds: number;
    validSessionCount: number;
    lessonCompletedCount: number;
    lessonAbandonedCount: number;
    lessonRestoredCount: number;
    courseClosedCount: number;
    activeDayCount: number;
    currentStreakDays: number;
    longestStreakDays: number;
    definitions: Readonly<Record<string, string>>;
  }>;

function streaks(dates: readonly string[]): { current: number; longest: number } {
  if (dates.length === 0) return { current: 0, longest: 0 };
  let run = 1;
  let longest = 1;
  for (let index = 1; index < dates.length; index += 1) {
    const previous = Date.parse(`${dates[index - 1]}T00:00:00.000Z`);
    const current = Date.parse(`${dates[index]}T00:00:00.000Z`);
    run = current - previous === 86_400_000 ? run + 1 : 1;
    longest = Math.max(longest, run);
  }
  return { current: run, longest };
}

export function createStatisticsProjection(timeZone: string) {
  const accumulator = createFactAccumulator();
  return {
    apply: accumulator.apply,
    view(): StatisticsView {
      const facts = accumulator.facts();
      const completed = facts.filter((fact) => fact.factType === 'LessonCompletedFact');
      const sessions = new Set(
        completed
          .map((fact) => fact.payload.sessionId ?? fact.subjectRefs.sessionId)
          .filter((value): value is string => typeof value === 'string'),
      );
      const days = [
        ...new Set(completed.map((fact) => localDate(fact.occurredAt, timeZone))),
      ].sort();
      const streak = streaks(days);
      return {
        ...status(facts),
        totalActualSeconds: completed.reduce((sum, fact) => sum + actualSeconds(fact), 0),
        validSessionCount: sessions.size,
        lessonCompletedCount: completed.length,
        lessonAbandonedCount: facts.filter((fact) => fact.factType === 'LessonAbandonedFact')
          .length,
        lessonRestoredCount: facts.filter((fact) => fact.factType === 'LessonRestoredFact').length,
        courseClosedCount: facts.filter((fact) => fact.factType === 'CourseClosedFact').length,
        activeDayCount: days.length,
        currentStreakDays: streak.current,
        longestStreakDays: streak.longest,
        definitions: {
          totalActualSeconds: 'metric.learning.actual_seconds',
          lessonCompletedCount: 'metric.lesson.completed_count',
          lessonAbandonedCount: 'metric.lesson.abandoned_count',
          lessonRestoredCount: 'metric.lesson.restored_count',
          courseClosedCount: 'metric.course.closed_count',
          activeDayCount: 'metric.learning.active_day_count',
          currentStreakDays: 'metric.learning.current_streak_days',
          longestStreakDays: 'metric.learning.longest_streak_days',
        },
      };
    },
  };
}
