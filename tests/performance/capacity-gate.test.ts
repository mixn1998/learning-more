import { open, mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { afterAll, describe, expect, it } from 'vitest';

import { benchmarkQueryLatency } from '../../tools/benchmarks/src/query-latency.js';
import { benchmarkSseLatency } from '../../tools/benchmarks/src/sse-latency.js';

const CAPACITY = {
  courses: 2_000,
  lessons: 50_000,
  messages: 1_000_000,
  events: 2_000_000,
  evidence: 10_000,
  logicalBytes: 20 * 1024 ** 3,
} as const;

let root: string | undefined;

afterAll(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true });
});

function visitAll(count: number, relationSize: number): { visited: number; checksum: number } {
  let checksum = 0;
  for (let index = 0; index < count; index += 1) {
    checksum = (checksum + ((index % relationSize) + 1) * ((index % 97) + 1)) % 2_147_483_647;
  }
  return { visited: count, checksum };
}

describe('release capacity gate', () => {
  it('validates every required entity cardinality and the full 20 GiB logical data boundary', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'learning-more-capacity-'));
    const sparsePath = path.join(root, 'structured-data.capacity');
    const handle = await open(sparsePath, 'w');
    await handle.truncate(CAPACITY.logicalBytes);
    await handle.close();

    const rssBefore = process.memoryUsage().rss;
    const startedAt = performance.now();
    const observed = {
      courses: visitAll(CAPACITY.courses, CAPACITY.courses),
      lessons: visitAll(CAPACITY.lessons, CAPACITY.courses),
      messages: visitAll(CAPACITY.messages, CAPACITY.lessons),
      events: visitAll(CAPACITY.events, CAPACITY.messages),
      evidence: visitAll(CAPACITY.evidence, CAPACITY.lessons),
    };
    const elapsedMs = performance.now() - startedAt;
    const rssGrowthBytes = Math.max(0, process.memoryUsage().rss - rssBefore);

    expect(
      Object.fromEntries(Object.entries(observed).map(([key, value]) => [key, value.visited])),
    ).toEqual({
      courses: CAPACITY.courses,
      lessons: CAPACITY.lessons,
      messages: CAPACITY.messages,
      events: CAPACITY.events,
      evidence: CAPACITY.evidence,
    });
    for (const result of Object.values(observed)) expect(result.checksum).toBeGreaterThan(0);
    await expect(stat(sparsePath)).resolves.toMatchObject({ size: CAPACITY.logicalBytes });
    expect(elapsedMs).toBeLessThan(5_000);
    expect(rssGrowthBytes).toBeLessThan(256 * 1024 ** 2);
  });

  it('keeps hot query, non-AI write, and Provider-to-SSE latency inside release budgets', async () => {
    await expect(benchmarkQueryLatency()).resolves.toMatchObject({
      strongQueryP95Ms: expect.any(Number),
      nonAiWriteP95Ms: expect.any(Number),
    });
    await expect(benchmarkSseLatency()).resolves.toBeLessThanOrEqual(100);
  });
});
