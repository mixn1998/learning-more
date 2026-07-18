import type { ReadModelStatus } from '../../interface.js';
import { actualSeconds, createFactAccumulator, localDate, status } from './shared.js';

type CalendarDay = Readonly<{
  localDate: string;
  actualSeconds: number;
  completedLessonIds: readonly string[];
  completions: readonly Readonly<{
    lessonId: string;
    courseId?: string;
    actualSeconds: number;
  }>[];
}>;

export type CalendarView = ReadModelStatus & Readonly<{ days: readonly CalendarDay[] }>;

export function selectCalendarMonth(view: CalendarView, yearMonth: string): CalendarView {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(yearMonth)) throw new Error('calendar_month_invalid');
  return { ...view, days: view.days.filter((day) => day.localDate.startsWith(`${yearMonth}-`)) };
}

export function createCalendarProjection(timeZone: string) {
  const accumulator = createFactAccumulator();
  return {
    apply: accumulator.apply,
    view(): CalendarView {
      const facts = accumulator.facts();
      const days = new Map<
        string,
        {
          actualSeconds: number;
          lessons: Map<string, { courseId?: string; actualSeconds: number }>;
        }
      >();
      for (const fact of facts) {
        if (fact.factType !== 'LessonCompletedFact') continue;
        const date = localDate(fact.occurredAt, timeZone);
        const current = days.get(date) ?? { actualSeconds: 0, lessons: new Map() };
        const seconds = actualSeconds(fact);
        current.actualSeconds += seconds;
        const lessonId = fact.subjectRefs.lessonId;
        if (lessonId !== undefined) {
          const completion = current.lessons.get(lessonId) ?? { actualSeconds: 0 };
          current.lessons.set(lessonId, {
            ...completion,
            ...(fact.subjectRefs.courseId === undefined
              ? {}
              : { courseId: fact.subjectRefs.courseId }),
            actualSeconds: completion.actualSeconds + seconds,
          });
        }
        days.set(date, current);
      }
      return {
        ...status(facts),
        days: [...days.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([date, value]) => ({
            localDate: date,
            actualSeconds: value.actualSeconds,
            completedLessonIds: [...value.lessons.keys()].sort(),
            completions: [...value.lessons.entries()]
              .sort(([left], [right]) => left.localeCompare(right))
              .map(([lessonId, completion]) => ({ lessonId, ...completion })),
          })),
      };
    },
  };
}
