import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { DataRoot } from '../../persistence/data-root.js';
import { createStorePaths, initializeStoreLayout } from '../../persistence/paths.js';
import { createGenerationFrameLog } from '../../modules/generation-runtime/implementation/frame-log.js';
import { registerLocalSecurity } from '../plugins/local-security.js';
import { registerGenerationRoutes } from './generation.js';

const roots: string[] = [];

async function fixture(maxFrames = 100) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'learning-more-sse-'));
  roots.push(directory);
  const dataRoot = DataRoot.create(directory);
  await initializeStoreLayout(createStorePaths(dataRoot));
  const frameLog = createGenerationFrameLog(dataRoot, { maxFrames });
  await frameLog.ensureTask('task_01', 'running');
  const app = Fastify();
  await registerLocalSecurity(app, { allowedOrigin: 'http://127.0.0.1:5173', csrfToken: 'csrf' });
  await registerGenerationRoutes(app, { frameLog, heartbeatIntervalMs: 1 });
  app.post('/write-test', async () => ({ ok: true }));
  await app.ready();
  return { app, frameLog };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe('generation SSE route', () => {
  it('resumes strictly after Last-Event-ID sequence 3', async () => {
    const { app, frameLog } = await fixture();
    for (let sequence = 1; sequence <= 5; sequence += 1) {
      await frameLog.append('task_01', 'task.progress', {
        current: sequence,
        total: 5,
        label: '生成',
      });
    }

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/generation-tasks/task_01/events',
      headers: {
        host: '127.0.0.1:43120',
        origin: 'http://127.0.0.1:5173',
        'last-event-id': 'task_01:3',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.payload).not.toContain('task_01:3');
    expect(response.payload).toContain('id: task_01:4');
    expect(response.payload).toContain('id: task_01:5');
  });

  it('sends a snapshot after the retention window and emits an idle heartbeat', async () => {
    const { app, frameLog } = await fixture(2);
    await frameLog.append('task_01', 'task.progress', { current: 1, total: 3, label: '生成' });
    await frameLog.append('task_01', 'task.progress', { current: 2, total: 3, label: '生成' });
    await frameLog.append('task_01', 'task.progress', { current: 3, total: 3, label: '生成' });

    const reset = await app.inject({
      method: 'GET',
      url: '/api/v1/generation-tasks/task_01/events',
      headers: { host: '127.0.0.1:43120', origin: 'http://127.0.0.1:5173' },
    });
    expect(reset.payload).toContain('event: task.snapshot');

    const heartbeat = await app.inject({
      method: 'GET',
      url: '/api/v1/generation-tasks/task_01/events',
      headers: {
        host: '127.0.0.1:43120',
        origin: 'http://127.0.0.1:5173',
        'last-event-id': 'task_01:3',
      },
    });
    expect(heartbeat.payload).toContain('event: heartbeat');
  });

  it('rejects non-loopback hosts and write requests without CSRF', async () => {
    const { app } = await fixture();

    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/generation-tasks/task_01/events',
          headers: { host: 'evil.example' },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/write-test',
          headers: { host: '127.0.0.1:43120', origin: 'http://127.0.0.1:5173' },
        })
      ).statusCode,
    ).toBe(403);
  });
});
