export type WeeklyReportWindow = Readonly<{
  localWeekKey: string;
  startLocalDate: string;
  endLocalDate: string;
}>;

function localDate(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function addDays(value: string, days: number): string {
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function weekday(value: string): number {
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function isoWeek(value: string): string {
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  const mondayBasedWeekday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - mondayBasedWeekday + 3);
  const weekYear = date.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(weekYear, 0, 4));
  const firstMondayBasedWeekday = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstMondayBasedWeekday + 3);
  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / 604_800_000);
  return `${weekYear}-W${String(week).padStart(2, '0')}`;
}

function offsetMilliseconds(instant: Date, timeZone: string): number {
  const name = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'longOffset',
  })
    .formatToParts(instant)
    .find((part) => part.type === 'timeZoneName')?.value;
  if (name === 'GMT' || name === 'UTC') return 0;
  const match = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/u.exec(name ?? '');
  if (match === null) throw new Error(`weekly_report_timezone_offset_unavailable:${timeZone}`);
  const sign = match[1] === '+' ? 1 : -1;
  return sign * (Number(match[2]) * 60 + Number(match[3] ?? 0)) * 60_000;
}

function localMidnightInstant(value: string, timeZone: string): Date {
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const utcMidnight = Date.UTC(year, month - 1, day);
  let candidate = new Date(utcMidnight - offsetMilliseconds(new Date(utcMidnight), timeZone));
  candidate = new Date(utcMidnight - offsetMilliseconds(candidate, timeZone));
  return candidate;
}

function assertWeekday(value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > 6) {
    throw new Error(`local_weekday_invalid:${value}`);
  }
}

export function currentLocalWeekdayCycleDate(
  now: Date,
  timeZone: string,
  targetWeekday: number,
): string {
  assertWeekday(targetWeekday);
  const today = localDate(now, timeZone);
  const daysSinceTarget = (weekday(today) - targetWeekday + 7) % 7;
  return addDays(today, -daysSinceTarget);
}

export function nextLocalWeekdayBoundary(now: Date, timeZone: string, targetWeekday: number): Date {
  assertWeekday(targetWeekday);
  const today = localDate(now, timeZone);
  const currentWeekday = weekday(today);
  const daysUntilTarget = (targetWeekday - currentWeekday + 7) % 7 || 7;
  return localMidnightInstant(addDays(today, daysUntilTarget), timeZone);
}

export function completedWeeklyReportWindow(now: Date, timeZone: string): WeeklyReportWindow {
  const today = localDate(now, timeZone);
  const endLocalDate = addDays(today, -weekday(today));
  const startLocalDate = addDays(endLocalDate, -7);
  return {
    localWeekKey: isoWeek(addDays(endLocalDate, -1)),
    startLocalDate,
    endLocalDate,
  };
}

export function nextWeeklyReportBoundary(now: Date, timeZone: string): Date {
  return nextLocalWeekdayBoundary(now, timeZone, 0);
}
