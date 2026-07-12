import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { DataRoot } from '../../../persistence/data-root.js';
import { createStorePaths, initializeStoreLayout } from '../../../persistence/paths.js';
import { createGenerationFrameLog } from '../implementation/frame-log.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('GenerationFrameLog recovery', () => {
  it('continues sequence and derives terminal state from frames when metadata is stale', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'learning-more-frame-recovery-'));
    roots.push(directory);
    const dataRoot = DataRoot.create(directory);
    await initializeStoreLayout(createStorePaths(dataRoot));
    const log = createGenerationFrameLog(dataRoot);
    const taskId = 'task_recovery';
    await log.ensureTask(taskId, 'running');
    await log.append(taskId, 'message.started', { messageId: 'message_01' });
    await log.append(taskId, 'message.delta', { messageId: 'message_01', markdown: 'partial' });
    const prefix = path.join(
      directory,
      'tasks',
      'journals',
      createHash('sha256').update(taskId).digest('hex'),
    );
    await writeFile(
      `${prefix}.meta.json`,
      JSON.stringify({ taskId, state: 'running', lastSequence: 0 }),
      'utf8',
    );
    await expect(
      log.append(taskId, 'task.completed', { resultRef: 'artifact_01' }),
    ).resolves.toMatchObject({
      sequence: 3,
    });
    await writeFile(
      `${prefix}.meta.json`,
      JSON.stringify({ taskId, state: 'running', lastSequence: 1 }),
      'utf8',
    );
    await expect(log.readAfter(taskId, 0)).resolves.toMatchObject({
      meta: { state: 'completed', lastSequence: 3 },
      frames: [
        { sequence: 1, type: 'message.started' },
        { sequence: 2, type: 'message.delta' },
        { sequence: 3, type: 'task.completed' },
      ],
    });
  });
});
