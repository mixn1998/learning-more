import { completedWeeklyReportWindow, nextWeeklyReportBoundary } from '@learning-more/contracts';

export type GenerateWeeklyReportCommand = Readonly<{
  localWeekKey: string;
  startLocalDate: string;
  endLocalDate: string;
}>;

export function createWeeklyReportScheduler(options: {
  timeZone: string;
  hasReport(localWeekKey: string): Promise<boolean>;
  enqueue(command: GenerateWeeklyReportCommand): Promise<void>;
  now?: () => Date;
}) {
  const now = options.now ?? (() => new Date());
  let timer: ReturnType<typeof setTimeout> | undefined;
  let started = false;
  let stopped = false;

  const tick = async (instant: Date) => {
    const command = completedWeeklyReportWindow(instant, options.timeZone);
    if (await options.hasReport(command.localWeekKey)) return undefined;
    await options.enqueue(command);
    return command;
  };

  const arm = () => {
    if (stopped) return;
    const instant = now();
    const delay = Math.max(
      1,
      nextWeeklyReportBoundary(instant, options.timeZone).getTime() - instant.getTime(),
    );
    timer = setTimeout(() => {
      void tick(now())
        .catch(() => undefined)
        .finally(arm);
    }, delay);
    timer.unref?.();
  };

  return {
    tick,
    async start() {
      if (started) return;
      started = true;
      stopped = false;
      await tick(now());
      arm();
    },
    stop() {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
  };
}
