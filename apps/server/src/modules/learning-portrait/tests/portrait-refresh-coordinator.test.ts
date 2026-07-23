import { describe, expect, it, vi } from 'vitest';

import { createPortraitRefreshCoordinator } from '../implementation/portrait-refresh-coordinator.js';

describe('PortraitRefreshCoordinator', () => {
  it('serializes scheduled and manual refreshes without poisoning the queue after failure', async () => {
    const order: string[] = [];
    let releaseScheduled: (() => void) | undefined;
    const perform = vi.fn(async ({ idempotencyKey }: { idempotencyKey: string }) => {
      order.push(`start:${idempotencyKey}`);
      if (idempotencyKey === 'weekly-portrait:2026-07-18') {
        await new Promise<void>((resolve) => {
          releaseScheduled = resolve;
        });
        order.push(`fail:${idempotencyKey}`);
        throw new Error('provider_timeout');
      }
      order.push(`finish:${idempotencyKey}`);
      return idempotencyKey;
    });
    const coordinator = createPortraitRefreshCoordinator({ perform });

    const scheduled = coordinator.request({
      idempotencyKey: 'weekly-portrait:2026-07-18',
      tokenBudget: 8_000,
    });
    const manual = coordinator.request({
      idempotencyKey: 'manual:portrait:01',
      tokenBudget: 8_000,
    });
    await Promise.resolve();
    expect(order).toEqual(['start:weekly-portrait:2026-07-18']);

    releaseScheduled?.();
    await expect(scheduled).rejects.toThrow('provider_timeout');
    await expect(manual).resolves.toBe('manual:portrait:01');
    expect(order).toEqual([
      'start:weekly-portrait:2026-07-18',
      'fail:weekly-portrait:2026-07-18',
      'start:manual:portrait:01',
      'finish:manual:portrait:01',
    ]);
  });
});
