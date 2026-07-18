import { describe, expect, it } from 'vitest';

import { mapConcurrentOrdered } from './concurrent-map.js';

describe('mapConcurrentOrdered', () => {
  it('bounds concurrency and preserves input order', async () => {
    let active = 0;
    let maximum = 0;
    const result = await mapConcurrentOrdered(
      [3, 2, 1, 0],
      async (value) => {
        active += 1;
        maximum = Math.max(maximum, active);
        await new Promise((resolve) => setTimeout(resolve, value * 2));
        active -= 1;
        return `value_${value}`;
      },
      2,
    );

    expect(maximum).toBe(2);
    expect(result).toEqual(['value_3', 'value_2', 'value_1', 'value_0']);
  });

  it('rejects invalid concurrency', async () => {
    await expect(mapConcurrentOrdered([], async () => undefined, 0)).rejects.toThrow(
      'CONCURRENCY_INVALID',
    );
  });
});
