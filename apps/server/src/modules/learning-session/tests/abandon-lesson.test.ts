import { describe, expect, it, vi } from 'vitest';

import { createInMemoryLearningSessionRepositories } from '../../../persistence/learning-session-repositories.js';
import { abandonLesson } from '../implementation/abandon-lesson.js';
import { createInMemoryMessageLog } from '../implementation/message-log.js';
import { createSessionModule } from '../implementation/session-module.js';

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
const baseContext = {
  correlationId: 'correlation_01',
  idempotencyKey: 'idem_01',
  actor: 'local-user' as const,
  requestedAt: '2026-07-13T00:00:00.000Z',
  receivedAt: '2026-07-13T00:00:00.000Z',
  pageInstanceId: 'page_01',
};

function fixture() {
  let now = new Date('2026-07-13T00:00:00.000Z');
  const repositories = createInMemoryLearningSessionRepositories();
  const module = createSessionModule({
    repositories,
    messageLog: createInMemoryMessageLog(),
    unitOfWork,
    instanceId: 'instance_01',
    nextSessionId: () => 'session_01',
    nextIntervalId: () => 'interval_01',
    nextLeaseToken: () => 'lease_01',
    now: () => now,
  });
  const stageReviews = {
    request: vi.fn().mockResolvedValue({ reviewId: 'review_01', taskId: 'task_01' }),
  };
  return {
    module,
    repositories,
    stageReviews,
    advance(ms: number) {
      now = new Date(now.getTime() + ms);
    },
  };
}

describe('abandonLesson', () => {
  it('removes an evidence-free session and its short time without requesting Review', async () => {
    const { module, stageReviews, advance } = fixture();
    await module.execute(
      { type: 'StartLesson', lessonId: 'lesson_01' },
      { ...baseContext, commandId: 'start' },
    );
    advance(5_000);
    const result = await abandonLesson(
      { lessonId: 'lesson_01', sourceSnapshotHash: 'a'.repeat(64) },
      { ...baseContext, commandId: 'abandon', expectedVersion: 1 },
      { sessionModule: module, stageReviews },
    );
    expect(result).toMatchObject({ progress: 'not_started', stageReview: undefined });
    expect(stageReviews.request).not.toHaveBeenCalled();
    const view = await module.query(
      { type: 'GetLessonLearning', lessonId: 'lesson_01' },
      { ...baseContext, correlationId: 'query' },
    );
    expect(view.actualSeconds).toBe(0);
    expect(view.learning.session).toBeUndefined();
  });

  it('freezes and restores the same evidenced source session while Review failure stays isolated', async () => {
    const { module, stageReviews } = fixture();
    await module.execute(
      { type: 'StartLesson', lessonId: 'lesson_01' },
      { ...baseContext, commandId: 'start' },
    );
    await module.execute(
      {
        type: 'AppendUserMessage',
        lessonId: 'lesson_01',
        messageId: 'message_01',
        contentArtifactRef: 'artifact:01',
        establishesEvidence: true,
      },
      { ...baseContext, commandId: 'message', expectedVersion: 1 },
    );
    const abandoned = await abandonLesson(
      { lessonId: 'lesson_01', sourceSnapshotHash: 'b'.repeat(64) },
      { ...baseContext, commandId: 'abandon', expectedVersion: 2 },
      { sessionModule: module, stageReviews },
    );
    expect(abandoned).toMatchObject({
      progress: 'abandoned',
      sessionId: 'session_01',
      stageReview: { reviewId: 'review_01', taskId: 'task_01' },
    });
    const restored = await module.execute(
      { type: 'RestoreLesson', lessonId: 'lesson_01' },
      { ...baseContext, commandId: 'restore', expectedVersion: 3 },
    );
    expect(restored.value).toMatchObject({ progress: 'in_progress', sessionId: 'session_01' });
  });

  it('keeps the lesson abandoned when stage Review request fails', async () => {
    const { module, stageReviews } = fixture();
    stageReviews.request.mockRejectedValueOnce(new Error('provider unavailable'));
    await module.execute(
      { type: 'StartLesson', lessonId: 'lesson_01' },
      { ...baseContext, commandId: 'start' },
    );
    await module.execute(
      {
        type: 'AppendUserMessage',
        lessonId: 'lesson_01',
        messageId: 'message_01',
        contentArtifactRef: 'artifact:01',
        establishesEvidence: true,
      },
      { ...baseContext, commandId: 'message', expectedVersion: 1 },
    );
    await expect(
      abandonLesson(
        { lessonId: 'lesson_01', sourceSnapshotHash: 'c'.repeat(64) },
        { ...baseContext, commandId: 'abandon', expectedVersion: 2 },
        { sessionModule: module, stageReviews },
      ),
    ).rejects.toThrow('provider unavailable');
    await expect(
      module.query(
        { type: 'GetLessonLearning', lessonId: 'lesson_01' },
        { ...baseContext, correlationId: 'query' },
      ),
    ).resolves.toMatchObject({
      resourceVersion: 3,
      learning: { progress: 'abandoned', session: { id: 'session_01', state: 'frozen' } },
    });
  });
});
