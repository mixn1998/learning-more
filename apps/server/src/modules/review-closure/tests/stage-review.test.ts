import { describe, expect, it, vi } from 'vitest';

import {
  createInMemoryReviewStateRepository,
  createStageReviewWorkflow,
} from '../implementation/stage-review.js';

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

describe('stage Review workflow', () => {
  it('reuses one task for a repeated abandonment command and preserves failure', async () => {
    const repository = createInMemoryReviewStateRepository();
    const submit = vi.fn().mockResolvedValue({ taskId: 'task_01' });
    const workflow = createStageReviewWorkflow({
      repository,
      unitOfWork,
      reviewTask: { submit },
      now: () => new Date('2026-07-13T00:00:00.000Z'),
    });
    const input = {
      lessonId: 'lesson_01',
      sourceSessionId: 'session_01',
      sourceSnapshotHash: 'a'.repeat(64),
      commandId: 'abandon_01',
    };
    const first = await workflow.request(input);
    const repeated = await workflow.request(input);
    expect(first).toEqual(repeated);
    expect(submit).toHaveBeenCalledTimes(1);

    await workflow.fail({
      reviewId: first.reviewId,
      taskId: first.taskId,
      errorCode: 'ai_unavailable',
      draftArtifactRef: 'draft_01',
    });
    await expect(repository.get(first.reviewId)).resolves.toMatchObject({
      status: 'failed',
      errorCode: 'ai_unavailable',
      draftArtifactRef: 'draft_01',
    });
  });

  it('atomically replaces the same stage reviewId without retaining a version timeline', async () => {
    const repository = createInMemoryReviewStateRepository();
    const commitToLearningSession = vi.fn().mockResolvedValue(undefined);
    let task = 0;
    const workflow = createStageReviewWorkflow({
      repository,
      unitOfWork,
      reviewTask: { submit: async () => ({ taskId: `task_${++task}` }) },
      commitToLearningSession,
      now: () => new Date('2026-07-13T00:00:00.000Z'),
    });
    const first = await workflow.request({
      lessonId: 'lesson_01',
      sourceSessionId: 'session_01',
      sourceSnapshotHash: 'a'.repeat(64),
      commandId: 'abandon_01',
    });
    await workflow.commit({
      reviewId: first.reviewId,
      taskId: first.taskId,
      artifactRef: 'artifact_stage_1',
      contentSha256: '1'.repeat(64),
    });
    const second = await workflow.request({
      lessonId: 'lesson_01',
      sourceSessionId: 'session_01',
      sourceSnapshotHash: 'b'.repeat(64),
      commandId: 'abandon_02',
    });
    await workflow.commit({
      reviewId: second.reviewId,
      taskId: second.taskId,
      artifactRef: 'artifact_stage_2',
      contentSha256: '2'.repeat(64),
    });

    expect(second.reviewId).toBe(first.reviewId);
    await expect(repository.get(first.reviewId)).resolves.toMatchObject({
      status: 'committed',
      artifactRef: 'artifact_stage_2',
      replacementCount: 2,
    });
    const all = [];
    for await (const review of repository.list()) all.push(review);
    expect(all).toHaveLength(1);
    expect(all[0]).not.toHaveProperty('versions');
    expect(commitToLearningSession).toHaveBeenLastCalledWith('lesson_01', first.reviewId);
  });
});
