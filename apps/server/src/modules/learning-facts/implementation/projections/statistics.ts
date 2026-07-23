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
    daily: readonly Readonly<{
      localDate: string;
      actualSeconds: number;
      completedLessonCount: number;
      closedCourseIds: readonly string[];
      abandonedCourseIds: readonly string[];
      interactionPromptedCount: number;
      interactionRespondedCount: number;
      interactionSkippedCount: number;
      actualSecondsByCourse: Readonly<Record<string, number>>;
    }>[];
    courseRollups: readonly Readonly<{
      courseId: string;
      actualSeconds: number;
      completedLessonCount: number;
      abandonedLessonCount: number;
      latestActivityDate?: string;
    }>[];
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
      const daily = new Map<
        string,
        {
          actualSeconds: number;
          completedLessonCount: number;
          closedCourseIds: Set<string>;
          abandonedCourseIds: Set<string>;
          interactionPromptedCount: number;
          interactionRespondedCount: number;
          interactionSkippedCount: number;
          actualSecondsByCourse: Record<string, number>;
        }
      >();
      const courseRollups = new Map<
        string,
        {
          actualSeconds: number;
          completedLessonCount: number;
          abandonedLessonCount: number;
          latestActivityDate?: string;
        }
      >();
      const dayFor = (occurredAt: string) => {
        const date = localDate(occurredAt, timeZone);
        const value = daily.get(date) ?? {
          actualSeconds: 0,
          completedLessonCount: 0,
          closedCourseIds: new Set<string>(),
          abandonedCourseIds: new Set<string>(),
          interactionPromptedCount: 0,
          interactionRespondedCount: 0,
          interactionSkippedCount: 0,
          actualSecondsByCourse: {},
        };
        daily.set(date, value);
        return { date, value };
      };
      for (const fact of facts) {
        const { date, value } = dayFor(fact.occurredAt);
        const courseId = fact.subjectRefs.courseId;
        if (fact.factType === 'LessonCompletedFact') {
          const seconds = actualSeconds(fact);
          value.actualSeconds += seconds;
          value.completedLessonCount += 1;
          if (courseId !== undefined) {
            value.actualSecondsByCourse[courseId] =
              (value.actualSecondsByCourse[courseId] ?? 0) + seconds;
            const rollup = courseRollups.get(courseId) ?? {
              actualSeconds: 0,
              completedLessonCount: 0,
              abandonedLessonCount: 0,
            };
            rollup.actualSeconds += seconds;
            rollup.completedLessonCount += 1;
            rollup.latestActivityDate =
              rollup.latestActivityDate === undefined || date > rollup.latestActivityDate
                ? date
                : rollup.latestActivityDate;
            courseRollups.set(courseId, rollup);
          }
        } else if (fact.factType === 'LessonAbandonedFact' && courseId !== undefined) {
          value.abandonedCourseIds.add(courseId);
          const rollup = courseRollups.get(courseId) ?? {
            actualSeconds: 0,
            completedLessonCount: 0,
            abandonedLessonCount: 0,
          };
          rollup.abandonedLessonCount += 1;
          courseRollups.set(courseId, rollup);
        } else if (fact.factType === 'CourseClosedFact' && courseId !== undefined) {
          value.closedCourseIds.add(courseId);
        } else if (fact.factType === 'InteractionPromptedFact') {
          value.interactionPromptedCount += 1;
        } else if (fact.factType === 'InteractionRespondedFact') {
          value.interactionRespondedCount += 1;
        } else if (fact.factType === 'InteractionSkippedFact') {
          value.interactionSkippedCount += 1;
        }
      }
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
        daily: [...daily.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([date, value]) => ({
            localDate: date,
            actualSeconds: value.actualSeconds,
            completedLessonCount: value.completedLessonCount,
            closedCourseIds: [...value.closedCourseIds].sort(),
            abandonedCourseIds: [...value.abandonedCourseIds].sort(),
            interactionPromptedCount: value.interactionPromptedCount,
            interactionRespondedCount: value.interactionRespondedCount,
            interactionSkippedCount: value.interactionSkippedCount,
            actualSecondsByCourse: value.actualSecondsByCourse,
          })),
        courseRollups: [...courseRollups.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([courseId, value]) => ({ courseId, ...value })),
      };
    },
  };
}
