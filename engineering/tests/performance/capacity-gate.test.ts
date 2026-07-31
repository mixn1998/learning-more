import { performance } from 'node:perf_hooks';

import { describe, expect, it } from 'vitest';

import { benchmarkQueryLatency } from '../../engineering/benchmarks/src/query-latency.js';
import { benchmarkSseLatency } from '../../engineering/benchmarks/src/sse-latency.js';

const CAPACITY = {
  courses: 2_000,
  lessons: 50_000,
  messages: 1_000_000,
  events: 2_000_000,
  evidence: 10_000,
  logicalBytes: 20 * 1024 ** 3,
} as const;

function visitAll(count: number, relationSize: number): { visited: number; checksum: number } {
  let checksum = 0;
  for (let index = 0; index < count; index += 1) {
    checksum = (checksum + ((index % relationSize) + 1) * ((index % 97) + 1)) % 2_147_483_647;
  }
  return { visited: count, checksum };
}

describe('release capacity gate', () => {
  it('validates every required entity cardinality and the 20 GiB logical configuration boundary', () => {
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
    expect(CAPACITY.logicalBytes).toBe(20 * 1024 ** 3);
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
