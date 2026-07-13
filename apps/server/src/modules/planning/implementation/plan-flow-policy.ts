export type PlanFlowLifecycleState = 'active' | 'paused' | 'deleted';
export type PlanFlowAction = 'pause' | 'resume' | 'reflow' | 'delete';

export function applyPlanFlowAction(
  state: PlanFlowLifecycleState,
  action: PlanFlowAction,
): PlanFlowLifecycleState {
  if (state === 'deleted') throw new Error('plan_flow_deleted');
  if (action === 'delete') return 'deleted';
  if (action === 'pause') {
    if (state !== 'active') throw new Error('plan_flow_not_active');
    return 'paused';
  }
  if (action === 'resume') {
    if (state !== 'paused') throw new Error('plan_flow_not_paused');
    return 'active';
  }
  if (state !== 'active') throw new Error('plan_flow_not_active');
  return 'active';
}

type Lesson = Readonly<{
  courseId: string;
  lessonId: string;
  order: number;
  estimatedMinutes: number;
  lifecycle?: 'not_started' | 'in_progress' | 'abandoned' | 'completed';
}>;

type ExistingAssignment = Readonly<{
  lessonId: string;
  plannedLocalDate: string;
  locked: boolean;
}>;

type PlannedAssignment = Lesson &
  Readonly<{
    plannedLocalDate: string;
    locked: boolean;
    overTarget: boolean;
  }>;

function addDays(localDate: string, days: number): string {
  const [year, month, day] = localDate.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export function reflowCourseLessons(
  input: Readonly<{
    startLocalDate: string;
    dailyCapacityMinutes: number;
    lessons: readonly Lesson[];
    existing: readonly ExistingAssignment[];
  }>,
): Readonly<{ assignments: readonly PlannedAssignment[] }> {
  if (!Number.isFinite(input.dailyCapacityMinutes) || input.dailyCapacityMinutes <= 0) {
    throw new Error('plan_flow_capacity_invalid');
  }
  const courseOrder = new Map<string, number>();
  for (const lesson of input.lessons) {
    if (!courseOrder.has(lesson.courseId)) courseOrder.set(lesson.courseId, courseOrder.size);
  }
  const lessons = input.lessons
    .filter((lesson) => lesson.lifecycle !== 'abandoned' && lesson.lifecycle !== 'completed')
    .sort(
      (left, right) =>
        courseOrder.get(left.courseId)! - courseOrder.get(right.courseId)! ||
        left.order - right.order ||
        left.lessonId.localeCompare(right.lessonId),
    );
  const locked = new Map(
    input.existing.filter((item) => item.locked).map((item) => [item.lessonId, item]),
  );
  let dayOffset = 0;
  let usedMinutes = 0;
  const assignments: PlannedAssignment[] = [];
  for (const lesson of lessons) {
    const existing = locked.get(lesson.lessonId);
    if (existing !== undefined) {
      assignments.push({
        ...lesson,
        plannedLocalDate: existing.plannedLocalDate,
        locked: true,
        overTarget: lesson.estimatedMinutes > input.dailyCapacityMinutes,
      });
      continue;
    }
    const overTarget = lesson.estimatedMinutes > input.dailyCapacityMinutes;
    if (usedMinutes > 0 && usedMinutes + lesson.estimatedMinutes > input.dailyCapacityMinutes) {
      dayOffset += 1;
      usedMinutes = 0;
    }
    assignments.push({
      ...lesson,
      plannedLocalDate: addDays(input.startLocalDate, dayOffset),
      locked: false,
      overTarget,
    });
    if (overTarget) {
      dayOffset += 1;
      usedMinutes = 0;
    } else {
      usedMinutes += lesson.estimatedMinutes;
    }
  }
  return { assignments };
}
