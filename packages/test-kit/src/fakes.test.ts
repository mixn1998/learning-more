import { access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { FakeClock, SequentialIdGenerator, createTempStore } from './index.js';

describe('FakeClock', () => {
  it('returns a defensive copy of the fixed instant', () => {
    const clock = new FakeClock('2026-07-13T02:00:00.000Z');

    const first = clock.now();
    first.setUTCFullYear(2030);

    expect(clock.now().toISOString()).toBe('2026-07-13T02:00:00.000Z');
  });

  it('advances only when the test asks it to', () => {
    const clock = new FakeClock('2026-07-13T02:00:00.000Z');

    clock.advanceBy(1_500);

    expect(clock.now().toISOString()).toBe('2026-07-13T02:00:01.500Z');
  });
});

describe('SequentialIdGenerator', () => {
  it('produces deterministic padded identifiers', () => {
    const ids = new SequentialIdGenerator();

    expect(ids.next('lesson')).toBe('lesson-0001');
    expect(ids.next('lesson')).toBe('lesson-0002');
  });
});

describe('createTempStore', () => {
  it('creates an isolated OS-temp directory and disposes it idempotently', async () => {
    const store = await createTempStore();
    expect(path.relative(tmpdir(), store.root)).not.toMatch(/^\.\./);
    await expect(access(store.root)).resolves.toBeUndefined();

    await store.dispose();
    await store.dispose();

    await expect(access(store.root)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
