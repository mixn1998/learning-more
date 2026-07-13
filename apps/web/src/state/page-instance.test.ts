import { describe, expect, it, vi } from 'vitest';

import { getPageInstanceId } from './page-instance.js';

describe('page instance identity', () => {
  it('is stable for the lifetime of one tab storage', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    const nextId = vi.fn(() => 'page_01');
    expect(getPageInstanceId(storage, nextId)).toBe('page_01');
    expect(getPageInstanceId(storage, nextId)).toBe('page_01');
    expect(nextId).toHaveBeenCalledTimes(1);
  });
});
