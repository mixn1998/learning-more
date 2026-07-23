import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createDiagnosticsArtifact } from './diagnostics.js';
import { createStructuredLogger } from './logger.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('redacted runtime diagnostics', () => {
  it('writes bounded structured logs and a path/secret-free diagnostic artifact', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'learning-more-diagnostics-'));
    roots.push(root);
    const logDirectory = path.join(root, 'logs');
    const logger = createStructuredLogger({
      directory: logDirectory,
      instanceId: 'instance_01',
      now: () => new Date('2026-07-13T00:00:00.000Z'),
    });
    await logger.log('generation', {
      level: 'error',
      component: 'GenerationRuntime',
      correlationId: 'correlation_01',
      eventCode: 'provider_failed',
      fields: {
        apiKey: 'sanitized-secret-06f65f9b3951',
        prompt: 'LM_DIAGNOSTIC_PROMPT',
        dataPath: 'D:\\private\\learning-more',
        safeTaskId: 'task_01',
      },
    });
    await logger.close();
    const artifact = await createDiagnosticsArtifact({
      outputDirectory: path.join(root, 'diagnostics'),
      logDirectory,
      publicConfig: {
        timezone: 'Asia/Shanghai',
        serverPort: 43120,
        providerId: 'mock',
        dataRoot: 'D:\\private\\learning-more',
      },
      manifest: {
        instanceId: 'instance_01',
        generation: 2,
        buildId: 'build_01',
        protocolVersion: '1',
        startedAt: '2026-07-13T00:00:00.000Z',
        projectRoot: 'D:\\private\\project',
      },
      checksumReport: { status: 'ok', checkedFiles: 8 },
      now: () => new Date('2026-07-13T00:01:00.000Z'),
    });
    const content = await readFile(artifact.filePath, 'utf8');
    expect(content).toContain('task_01');
    expect(content).toContain('Asia/Shanghai');
    for (const forbidden of [
      'sanitized-secret-06f65f9b3951',
      'LM_DIAGNOSTIC_PROMPT',
      'D:\\private',
      'dataRoot',
      'projectRoot',
    ]) {
      expect(content).not.toContain(forbidden);
    }
  });
});
