import { currentLocalWeekdayCycleDate, nextLocalWeekdayBoundary } from '@learning-more/contracts';

const SATURDAY = 6;

export type ScheduledPortraitRefresh = Readonly<{
  cycleLocalDate: string;
  idempotencyKey: string;
  tokenBudget: number;
}>;

export function createWeeklyPortraitScheduler(options: {
  timeZone: string;
  refresh(command: ScheduledPortraitRefresh): Promise<unknown>;
  tokenBudget?: number;
  now?: () => Date;
}) {
  const now = options.now ?? (() => new Date());
  const tokenBudget = options.tokenBudget ?? 8_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let started = false;
  let stopped = false;

  const tick = async (instant: Date) => {
    const cycleLocalDate = currentLocalWeekdayCycleDate(instant, options.timeZone, SATURDAY);
    const command = {
      cycleLocalDate,
      idempotencyKey: `weekly-portrait:${cycleLocalDate}`,
      tokenBudget,
    } as const;
    await options.refresh(command);
    return command;
  };

  const trigger = (instant: Date) => {
    void tick(instant).catch(() => undefined);
  };

  const arm = () => {
    if (stopped) return;
    const instant = now();
    const delay = Math.max(
      1,
      nextLocalWeekdayBoundary(instant, options.timeZone, SATURDAY).getTime() - instant.getTime(),
    );
    timer = setTimeout(() => {
      trigger(now());
      arm();
    }, delay);
    timer.unref?.();
  };

  return {
    tick,
    start() {
      if (started) return;
      started = true;
      stopped = false;
      arm();
    },
    stop() {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
  };
}
