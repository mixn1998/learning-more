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

  it('retracts every fact contributed by a permanently deleted course during replay', async () => {
    const repository = createInMemoryFactRepository();
    const projector = createFactProjector({ repository, unitOfWork });
    const deletedCourseFact = {
      ...event('LessonSessionCompleted'),
      id: 'event_deleted_course',
      target_refs: { courseId: 'course_delete', lessonId: 'lesson_delete' },
    };
    const retainedCourseFact = {
      ...event('LessonSessionCompleted'),
      id: 'event_retained_course',
      target_refs: { courseId: 'course_keep', lessonId: 'lesson_keep' },
    };
    await projector.project(deletedCourseFact);
    await projector.project(retainedCourseFact);

    await expect(
      projector.project({
        ...event('CourseArchiveDeleted'),
        id: 'event_course_archive_deleted',
        target_refs: { courseId: 'course_delete' },
        payload: {},
      }),
    ).resolves.toEqual({ appended: 0, duplicates: 0, ignored: 0, retracted: 1 });

    const remaining = [];
    for await (const fact of repository.list()) remaining.push(fact.subjectRefs.courseId);
    expect(remaining).toEqual(['course_keep']);
  });
});
