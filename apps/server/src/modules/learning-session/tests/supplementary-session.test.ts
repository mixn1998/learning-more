import { describe, expect, it } from 'vitest';

import { createInMemorySupplementarySessionRepository } from '../../../persistence/supplementary-session-repository.js';
import { createInMemoryMessageLog } from '../implementation/message-log.js';
import { createSupplementarySessionModule } from '../implementation/supplementary-session-module.js';

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

describe('SupplementarySession module', () => {
  it('[EQ-HIS-02] starts a separate session only from an immutable completed Review and never mutates the original or Review', async () => {
    const finalReview = {
      id: 'review_final_01',
      artifactRef: 'artifact_final_01',
      contentSha256: 'a'.repeat(64),
    };
    const repository = createInMemorySupplementarySessionRepository();
    const module = createSupplementarySessionModule({
      repository,
      messageLog: createInMemoryMessageLog(),
      unitOfWork,
      getCompletedLesson: async () => ({ courseId: 'course_01', finalReview }),
      nextSessionId: () => 'supplementary_01',
      now: () => new Date('2026-07-13T00:00:00.000Z'),
    });

    const started = await module.execute({
      type: 'StartSupplementarySession',
      lessonId: 'lesson_01',
    });
    expect(started).toMatchObject({
      id: 'supplementary_01',
      sourceFinalReviewId: 'review_final_01',
      messageIds: [],
      resourceVersion: 1,
    });
    await module.execute({
      type: 'StartSupplementaryTurn',
      supplementarySessionId: started.id,
      taskId: 'task_01',
      message: {
        id: 'message_supplementary_01',
        role: 'user',
        createdAt: '2026-07-13T00:00:01.000Z',
        contentArtifactRef: 'message_supplementary_01',
        completionStatus: 'complete',
      },
      expectedVersion: 1,
    });
    expect(await repository.get(started.id)).toMatchObject({
      messageIds: ['message_supplementary_01'],
      resourceVersion: 2,
    });
    const listed = [];
    for await (const session of module.listByLesson('lesson_01')) listed.push(session.id);
    expect(listed).toEqual(['supplementary_01']);
    expect(finalReview).toEqual({
      id: 'review_final_01',
      artifactRef: 'artifact_final_01',
      contentSha256: 'a'.repeat(64),
    });
  });

  it('rejects non-completed lessons and prevents writes after archive', async () => {
    const repository = createInMemorySupplementarySessionRepository();
    const blocked = createSupplementarySessionModule({
      repository,
      messageLog: createInMemoryMessageLog(),
      unitOfWork,
      getCompletedLesson: async () => undefined,
      nextSessionId: () => 'supplementary_01',
      now: () => new Date('2026-07-13T00:00:00.000Z'),
    });
    await expect(
      blocked.execute({ type: 'StartSupplementarySession', lessonId: 'lesson_01' }),
    ).rejects.toMatchObject({ code: 'lesson_not_completed' });

    const module = createSupplementarySessionModule({
      repository,
      messageLog: createInMemoryMessageLog(),
      unitOfWork,
      getCompletedLesson: async () => ({
        courseId: 'course_01',
        finalReview: { id: 'review_final_01' },
      }),
      nextSessionId: () => 'supplementary_01',
      now: () => new Date('2026-07-13T00:00:00.000Z'),
    });
    const started = await module.execute({
      type: 'StartSupplementarySession',
      lessonId: 'lesson_01',
    });
    await module.execute({
      type: 'ArchiveSupplementarySession',
      supplementarySessionId: started.id,
      expectedVersion: 1,
    });
    await expect(
      module.execute({
        type: 'StartSupplementaryTurn',
        supplementarySessionId: started.id,
        taskId: 'task_late',
        message: {
          id: 'late_message',
          role: 'user',
          createdAt: '2026-07-13T00:00:01.000Z',
          contentArtifactRef: 'late_message',
          completionStatus: 'complete',
        },
        expectedVersion: 2,
      }),
    ).rejects.toMatchObject({ code: 'supplementary_session_archived' });
  });

  it('renames active and archived sessions with optimistic concurrency', async () => {
    const repository = createInMemorySupplementarySessionRepository();
    const module = createSupplementarySessionModule({
      repository,
      messageLog: createInMemoryMessageLog(),
      unitOfWork,
      getCompletedLesson: async () => ({
        courseId: 'course_01',
        finalReview: { id: 'review_final_01' },
      }),
      nextSessionId: () => 'supplementary_01',
      now: () => new Date('2026-07-13T00:00:00.000Z'),
    });
    const started = await module.execute({
      type: 'StartSupplementarySession',
      lessonId: 'lesson_01',
    });
    const renamed = await module.execute({
      type: 'RenameSupplementarySession',
      supplementarySessionId: started.id,
      title: '函数边界补充讨论',
      expectedVersion: started.resourceVersion,
    });
    const archived = await module.execute({
      type: 'ArchiveSupplementarySession',
      supplementarySessionId: started.id,
      expectedVersion: renamed.resourceVersion,
    });
    const renamedArchived = await module.execute({
      type: 'RenameSupplementarySession',
      supplementarySessionId: started.id,
      title: '函数边界复盘',
      expectedVersion: archived.resourceVersion,
    });

    expect(renamedArchived).toMatchObject({
      title: '函数边界复盘',
      status: 'archived',
      resourceVersion: 4,
    });
    await expect(
      module.execute({
        type: 'RenameSupplementarySession',
        supplementarySessionId: started.id,
        title: '过期覆盖',
        expectedVersion: renamed.resourceVersion,
      }),
    ).rejects.toMatchObject({ code: 'version_conflict' });
  });
});
