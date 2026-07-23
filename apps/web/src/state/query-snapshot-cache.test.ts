// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import { QuerySnapshotCache } from './query-snapshot-cache.js';

describe('QuerySnapshotCache', () => {
  it('shows a stored snapshot immediately and revalidates it with one shared request', async () => {
    sessionStorage.setItem(
      'learning-more:snapshot:home-test',
      JSON.stringify({ contractVersion: 1, etag: '"1"', data: { value: 'cached' } }),
    );
    let resolve!: (value: { status: 'unchanged'; etag: string }) => void;
    const load = vi.fn(
      () =>
        new Promise<{ status: 'unchanged'; etag: string }>((done) => {
          resolve = done;
        }),
    );
    const cache = new QuerySnapshotCache({ key: 'home-test', contractVersion: 1, load });

    expect(cache.read()).toEqual({ value: 'cached' });
    const first = cache.revalidate();
    const second = cache.revalidate();
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith('"1"', undefined);
    resolve({ status: 'unchanged', etag: '"1"' });
    await expect(first).resolves.toBe('unchanged');
    await expect(second).resolves.toBe('unchanged');
  });
});
