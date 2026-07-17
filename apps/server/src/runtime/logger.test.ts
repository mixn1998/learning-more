import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createStructuredLogger } from './logger.js';

const roots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('structured logger', () => {
  it('serializes writes and persists a valid JSON line', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'learning-more-logger-'));
    roots.push(directory);
    const logger = createStructuredLogger({
      directory,
      instanceId: 'instance-test',
      now: () => new Date('2026-07-17T00:00:00.000Z'),
    });

    await Promise.all([
      logger.log('runtime', {
        level: 'info',
        component: 'ServerBootstrap',
        correlationId: 'one',
        eventCode: 'server_starting',
      }),
      logger.log('runtime', {
        level: 'info',
        component: 'ServerBootstrap',
        correlationId: 'two',
        eventCode: 'server_ready',
      }),
    ]);

    const lines = (await readFile(path.join(directory, 'runtime-2026-07-17.jsonl'), 'utf8'))
      .trim()
      .split('\n');
    expect(lines).toHaveLength(2);
    expect(lines.map((line) => JSON.parse(line))).toEqual([
      expect.objectContaining({ correlationId: 'one' }),
      expect.objectContaining({ correlationId: 'two' }),
    ]);
  });
});
