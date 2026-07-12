import { isoWeek, localDate } from './projections/shared.js';

export type GenerateWeeklyReportCommand = Readonly<{
  localWeekKey: string;
  startLocalDate: string;
  endLocalDate: string;
}>;

function addDays(value: string, days: number): string {
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export function createWeeklyReportScheduler(options: {
  timeZone: string;
  hasReport(localWeekKey: string): Promise<boolean>;
  enqueue(command: GenerateWeeklyReportCommand): Promise<void>;
}) {
  return {
    async tick(now: Date) {
      const today = localDate(now.toISOString(), options.timeZone);
      const [year, month, day] = today.split('-').map(Number) as [number, number, number];
      const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
      const endLocalDate = addDays(today, -weekday);
      const startLocalDate = addDays(endLocalDate, -7);
      const localWeekKey = isoWeek(addDays(endLocalDate, -1));
      if (await options.hasReport(localWeekKey)) return undefined;
      const command = { localWeekKey, startLocalDate, endLocalDate };
      await options.enqueue(command);
      return command;
    },
  };
}
