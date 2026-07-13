import type { ScheduleItem } from '../model/schedule-item.js';

export type PlanningScheduleStatus = 'unplanned' | 'planned' | 'overdue';
export type PlanningLessonProgress = 'not_started' | 'in_progress' | 'abandoned' | 'completed';

function localDate(instant: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(instant));
  const value = (type: 'year' | 'month' | 'day') => parts.find((part) => part.type === type)!.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export function derivePlanningScheduleStatus(
  item: ScheduleItem | undefined,
  lessonProgress: PlanningLessonProgress,
  todayLocalDate: string,
): PlanningScheduleStatus {
  if (lessonProgress === 'completed' || lessonProgress === 'abandoned') {
    throw new Error('lesson_not_plannable');
  }
  if (item === undefined || item.status === 'removed') return 'unplanned';
  const plannedDate = localDate(item.startAt, item.timezoneAtCreation);
  return plannedDate < todayLocalDate ? 'overdue' : 'planned';
}

export function selectPlanningCandidates<T extends Readonly<{ progress: PlanningLessonProgress }>>(
  lessons: readonly T[],
): T[] {
  return lessons.filter(
    (lesson) => lesson.progress === 'not_started' || lesson.progress === 'in_progress',
  );
}

export type ScheduleCancellationHistory = Readonly<{
  type: 'ScheduleCancelled';
  scheduleItemId: string;
  lessonId: string;
  occurredAt: string;
  reason: 'lesson_abandoned';
}>;

export function cancelActiveSchedulesForAbandonment(
  items: readonly ScheduleItem[],
  lessonId: string,
  occurredAt: string,
): Readonly<{
  items: readonly ScheduleItem[];
  history: readonly ScheduleCancellationHistory[];
  restore(): readonly ScheduleItem[];
}> {
  const history: ScheduleCancellationHistory[] = [];
  const cancelled = items.map((item): ScheduleItem => {
    if (item.lessonId !== lessonId || item.status !== 'scheduled') return item;
    history.push({
      type: 'ScheduleCancelled',
      scheduleItemId: item.id,
      lessonId,
      occurredAt,
      reason: 'lesson_abandoned',
    });
    return {
      ...item,
      status: 'removed',
      cancelReason: 'lesson_abandoned',
      updatedAt: occurredAt,
      resourceVersion: item.resourceVersion + 1,
    };
  });
  return {
    items: cancelled,
    history,
    restore: () => cancelled.map((item) => ({ ...item })),
  };
}
