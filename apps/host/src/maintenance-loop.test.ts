import { describe, expect, it, vi } from 'vitest';

import { createMaintenanceLoop } from './maintenance-loop.js';

describe('maintenance lifecycle loop', () => {
  it('runs immediately, serializes work, and stops without another cycle', async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const run = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const loop = createMaintenanceLoop({ run, intervalMs: 1_000 });
    loop.start();
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(run).toHaveBeenCalledTimes(1);
    release();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(run).toHaveBeenCalledTimes(2);
    release();
    await loop.stop();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(run).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
