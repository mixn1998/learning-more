import { describe, expect, it, vi } from 'vitest';

import { createWeeklyPortraitScheduler } from '../implementation/weekly-portrait-scheduler.js';

describe('WeeklyPortraitScheduler', () => {
  it('uses one durable idempotency key for every refresh attempt in the same Saturday cycle', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    const scheduler = createWeeklyPortraitScheduler({
      timeZone: 'Asia/Shanghai',
      refresh,
    });

    await scheduler.tick(new Date('2026-07-18T00:00:00+08:00'));
    await scheduler.tick(new Date('2026-07-24T23:59:59+08:00'));

    expect(refresh).toHaveBeenNthCalledWith(1, {
      cycleLocalDate: '2026-07-18',
      idempotencyKey: 'weekly-portrait:2026-07-18',
      tokenBudget: 8_000,
    });
    expect(refresh).toHaveBeenNthCalledWith(2, {
      cycleLocalDate: '2026-07-18',
      idempotencyKey: 'weekly-portrait:2026-07-18',
      tokenBudget: 8_000,
    });
  });

  it('stays idle before the boundary and triggers at Saturday 00:00', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-17T15:59:30.000Z'));
    try {
      const commands: string[] = [];
      const refresh = vi.fn(async ({ idempotencyKey }: { idempotencyKey: string }) => {
        commands.push(idempotencyKey);
      });
      const scheduler = createWeeklyPortraitScheduler({
        timeZone: 'Asia/Shanghai',
        refresh,
      });

      scheduler.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(commands).toEqual([]);

      await vi.advanceTimersByTimeAsync(30_000);
      expect(commands).toEqual(['weekly-portrait:2026-07-18']);
      scheduler.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not block application startup while a background refresh is running', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-17T15:59:30.000Z'));
    let resolveRefresh: (() => void) | undefined;
    const refresh = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRefresh = resolve;
        }),
    );
    const scheduler = createWeeklyPortraitScheduler({
      timeZone: 'Asia/Shanghai',
      refresh,
    });

    try {
      expect(scheduler.start()).toBeUndefined();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(refresh).toHaveBeenCalledTimes(1);
      scheduler.stop();
      resolveRefresh?.();
    } finally {
      vi.useRealTimers();
    }
  });
});
