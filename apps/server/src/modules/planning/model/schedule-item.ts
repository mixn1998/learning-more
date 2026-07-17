export type ScheduleSource = 'manual' | 'plan-flow';

export type ScheduleItem = Readonly<{
  id: string;
  courseId: string;
  lessonId: string;
  startAt: string;
  endAt: string;
  timezoneAtCreation: string;
  source: ScheduleSource;
  status: 'scheduled' | 'removed';
  locked?: boolean;
  cancelReason?: 'lesson_abandoned' | 'user_removed' | 'outline_revised';
  createdAt: string;
  updatedAt: string;
  processedCommandIds: readonly string[];
  resourceVersion: number;
}>;

export class ScheduleRuleError extends Error {
  constructor(
    readonly code:
      'schedule_interval_invalid' | 'schedule_timezone_invalid' | 'schedule_item_removed',
  ) {
    super(code);
    this.name = 'ScheduleRuleError';
  }
}

function isCanonicalUtc(value: string): boolean {
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

export function validateScheduleInterval(startAt: string, endAt: string): void {
  if (
    !isCanonicalUtc(startAt) ||
    !isCanonicalUtc(endAt) ||
    Date.parse(endAt) <= Date.parse(startAt)
  ) {
    throw new ScheduleRuleError('schedule_interval_invalid');
  }
}

export function validateTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date(0));
  } catch {
    throw new ScheduleRuleError('schedule_timezone_invalid');
  }
}

export function overlaps(
  left: Pick<ScheduleItem, 'startAt' | 'endAt'>,
  right: Pick<ScheduleItem, 'startAt' | 'endAt'>,
): boolean {
  return (
    Date.parse(left.startAt) < Date.parse(right.endAt) &&
    Date.parse(left.endAt) > Date.parse(right.startAt)
  );
}
