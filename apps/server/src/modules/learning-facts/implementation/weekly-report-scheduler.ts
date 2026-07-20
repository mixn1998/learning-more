import { completedWeeklyReportWindow, nextWeeklyReportBoundary } from '@learning-more/contracts';

export type GenerateWeeklyReportCommand = Readonly<{
  localWeekKey: string;
  startLocalDate: string;
  endLocalDate: string;
}>;

export function createWeeklyReportScheduler(options: {
  timeZone: string;
  reconcile(command: GenerateWeeklyReportCommand): Promise<Date | undefined>;
  now?: () => Date;
  failureRetryMilliseconds?: number;
}) {
  const now = options.now ?? (() => new Date());
  const failureRetryMilliseconds = options.failureRetryMilliseconds ?? 5 * 60_000;
  let boundaryTimer: ReturnType<typeof setTimeout> | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let started = false;
  let stopped = false;
  let pendingInstant: Date | undefined;
  let running: Promise<GenerateWeeklyReportCommand | undefined> | undefined;

  const clearRetryTimer = () => {
    if (retryTimer !== undefined) clearTimeout(retryTimer);
    retryTimer = undefined;
  };

  const scheduleRetry = (nextRetryAt: Date | undefined) => {
    clearRetryTimer();
    if (stopped || nextRetryAt === undefined) return;
    const delay = Math.max(1, nextRetryAt.getTime() - now().getTime());
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      void tick(now()).catch(() => undefined);
    }, delay);
    retryTimer.unref?.();
  };

  const drain = async (): Promise<GenerateWeeklyReportCommand | undefined> => {
    let last: GenerateWeeklyReportCommand | undefined;
    while (pendingInstant !== undefined) {
      const instant = pendingInstant;
      pendingInstant = undefined;
      const command = completedWeeklyReportWindow(instant, options.timeZone);
      try {
        scheduleRetry(await options.reconcile(command));
      } catch (error) {
        scheduleRetry(new Date(now().getTime() + failureRetryMilliseconds));
        throw error;
      }
      last = command;
    }
    return last;
  };

  const tick = (instant: Date): Promise<GenerateWeeklyReportCommand | undefined> => {
    if (pendingInstant === undefined || instant > pendingInstant) pendingInstant = instant;
    running ??= drain().finally(() => {
      running = undefined;
    });
    return running;
  };

  const armBoundary = () => {
    if (stopped) return;
    const instant = now();
    const delay = Math.max(
      1,
      nextWeeklyReportBoundary(instant, options.timeZone).getTime() - instant.getTime(),
    );
    boundaryTimer = setTimeout(() => {
      armBoundary();
      void tick(now()).catch(() => undefined);
    }, delay);
    boundaryTimer.unref?.();
  };

  return {
    tick,
    async start() {
      if (started) return;
      started = true;
      stopped = false;
      armBoundary();
      void tick(now()).catch(() => {
        // The durable failed state is retried by the timer scheduled in drain().
      });
    },
    async stop() {
      stopped = true;
      if (boundaryTimer !== undefined) clearTimeout(boundaryTimer);
      boundaryTimer = undefined;
      clearRetryTimer();
      await running?.catch(() => undefined);
    },
  };
}
