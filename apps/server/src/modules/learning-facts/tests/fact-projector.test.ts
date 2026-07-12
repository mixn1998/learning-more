import { describe, expect, it } from 'vitest';

import type { LearningEventEnvelope } from '@learning-more/contracts';

import { createInMemoryFactRepository } from '../ports/fact-repository.js';
import { createFactProjector } from '../implementation/fact-projector.js';

const tx = {
  stageJson: async () => undefined,
  stageText: async () => undefined,
  deleteOnCommit: async () => undefined,
};
const unitOfWork = {
  async execute<T>(_request: unknown, work: (context: typeof tx) => Promise<T>) {
    return work(tx);
  },
};

function event(type: string): LearningEventEnvelope {
  return {
    id: `event_${type}`,
    schema_version: 1,
    type,
    occurred_at: '2026-07-13T01:00:00.000Z',
    recorded_at: '2026-07-13T01:00:01.000Z',
    source: 'test',
    target_refs: { lessonId: 'lesson_01' },
    payload: { actualSeconds: 120 },
    idempotency_key: `idem_${type}`,
    correlation_id: 'correlation_01',
  } as LearningEventEnvelope;
}

describe('FactProjector', () => {
  it('deduplicates replay and exposes ignored event counts without inventing facts', async () => {
    const repository = createInMemoryFactRepository();
    const projector = createFactProjector({ repository, unitOfWork });
    await expect(projector.project(event('LessonSessionCompleted'))).resolves.toEqual({
      appended: 1,
      duplicates: 0,
      ignored: 0,
    });
    await expect(projector.project(event('LessonSessionCompleted'))).resolves.toEqual({
      appended: 0,
      duplicates: 1,
      ignored: 0,
    });
    await expect(projector.project(event('UiPageViewed'))).resolves.toEqual({
      appended: 0,
      duplicates: 0,
      ignored: 1,
    });
    expect(projector.ignoredCount()).toBe(1);
  });
});
