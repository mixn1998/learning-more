import { describe, expect, it } from 'vitest';

import { createInMemorySupplementarySessionRepository } from '../../../persistence/supplementary-session-repository.js';
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
      type: 'AppendSupplementaryMessage',
      supplementarySessionId: started.id,
      messageId: 'message_supplementary_01',
      expectedVersion: 1,
    });
    expect(await repository.get(started.id)).toMatchObject({
      messageIds: ['message_supplementary_01'],
      resourceVersion: 2,
    });
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
        type: 'AppendSupplementaryMessage',
        supplementarySessionId: started.id,
        messageId: 'late_message',
        expectedVersion: 2,
      }),
    ).rejects.toMatchObject({ code: 'supplementary_session_archived' });
  });
});
