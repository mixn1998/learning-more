import { describe, expect, it } from 'vitest';

import {
  compactGenerationTask,
  shouldCompactGenerationTask,
} from '../implementation/generation-task-lifecycle.js';
import type { GenerationTask } from '../ports/generation-task-repository.js';

function task(overrides: Partial<GenerationTask> = {}): GenerationTask {
  return {
    id: 'task_1',
    taskKey: 'lesson:1',
    status: 'completed',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:01:00.000Z',
    resourceVersion: 4,
    prompt: 'large prompt',
    draftMarkdown: 'large response',
    resultRef: 'generation-task:task_1:draft',
    fallbackProviderIds: ['fallback'],
    maxAttempts: 3,
    leaseExpiresAt: '2026-07-01T00:02:00.000Z',
    ...overrides,
  };
}

describe('generation task lifecycle', () => {
  it('compacts completed task details after the recovery window', () => {
    const now = new Date('2026-07-03T00:00:00.000Z');
    expect(shouldCompactGenerationTask(task(), now)).toBe(true);
    const compacted = compactGenerationTask(task(), now);
    expect(compacted).toMatchObject({
      id: 'task_1',
      status: 'completed',
      compactedAt: now.toISOString(),
    });
    expect(compacted).not.toHaveProperty('prompt');
    expect(compacted).not.toHaveProperty('draftMarkdown');
    expect(compacted).not.toHaveProperty('resultRef');
    expect(compacted).not.toHaveProperty('leaseExpiresAt');
  });

  it('keeps active tasks and recent terminal details intact', () => {
    const now = new Date('2026-07-01T12:00:00.000Z');
    expect(shouldCompactGenerationTask(task({ status: 'running' }), now)).toBe(false);
    expect(shouldCompactGenerationTask(task(), now)).toBe(false);
    expect(
      shouldCompactGenerationTask(
        task({ status: 'failed', updatedAt: '2026-06-26T00:00:00.000Z' }),
        now,
      ),
    ).toBe(false);
  });

  it('never rewrites an existing terminal receipt', () => {
    expect(
      shouldCompactGenerationTask(
        task({ compactedAt: '2026-07-02T00:00:00.000Z' }),
        new Date('2026-08-01T00:00:00.000Z'),
      ),
    ).toBe(false);
  });
});
