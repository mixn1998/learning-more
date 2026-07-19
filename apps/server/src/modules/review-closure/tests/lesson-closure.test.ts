import { describe, expect, it, vi } from 'vitest';

import { createInMemoryLearningSessionRepositories } from '../../../persistence/learning-session-repositories.js';
import { createInMemoryMessageLog } from '../../learning-session/implementation/message-log.js';
import { createSessionModule } from '../../learning-session/implementation/session-module.js';
import { createSupplementarySession } from '../../learning-session/model/supplementary-session.js';
import {
  createInMemoryLessonClosureRepository,
  createLessonClosureWorkflow,
} from '../implementation/lesson-closure.js';

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

async function fixture(
  crashAfterLearningCommit = false,
  assertLessonWritable?: (lessonId: string) => Promise<void>,
  submitReview: () => Promise<{ taskId: string }> = async () => ({ taskId: 'task_01' }),
) {
  const repositories = createInMemoryLearningSessionRepositories();
  const sessionModule = createSessionModule({
    repositories,
    messageLog: createInMemoryMessageLog(),
    unitOfWork,
    instanceId: 'instance_01',
    nextSessionId: () => 'session_01',
    nextIntervalId: () => 'interval_01',
    nextLeaseToken: () => 'lease_01',
    now: () => new Date('2026-07-13T00:00:00.000Z'),
  });
  await sessionModule.execute(
    { type: 'StartLesson', lessonId: 'lesson_01' },
    { ...baseContext, commandId: 'start' },
  );
  await sessionModule.execute(
    {
      type: 'AppendUserMessage',
      lessonId: 'lesson_01',
      messageId: 'message_01',
      contentArtifactRef: 'artifact:user:01',
    },
    { ...baseContext, commandId: 'message', expectedVersion: 1 },
  );
  await sessionModule.execute(
    { type: 'EstablishEvidenceCheckpoint', lessonId: 'lesson_01' },
    { ...baseContext, commandId: 'observed', expectedVersion: 2 },
  );
  const closureRepository = createInMemoryLessonClosureRepository();
  let crashed = false;
  const workflow = createLessonClosureWorkflow({
    repository: closureRepository,
    unitOfWork,
    sessionModule,
    reviewTask: { submit: submitReview },
    nextTransactionId: () => 'closure_01',
    nextReviewId: () => 'review_final_01',
    now: () => new Date('2026-07-13T00:01:00.000Z'),
    ...(assertLessonWritable === undefined ? {} : { assertLessonWritable }),
    ...(crashAfterLearningCommit
      ? {
          afterLearningCommit: () => {
            if (!crashed) {
              crashed = true;
              throw new Error('simulated crash');
            }
          },
        }
      : {}),
  });
  return { workflow, closureRepository, sessionModule };
}

const snapshot = {
  lessonId: 'lesson_01',
  sessionId: 'session_01',
  sourceSessionIds: ['session_01'],
  sourceMessageIds: ['message_01'],
  messageRangeChecksum: 'a'.repeat(64),
  endIntent: 'finish lesson',
  expectedSessionVersion: 3,
};
const review = {
  artifactRef: 'artifact:final-review',
  markdown: '# Final Review\nSolid progress.',
  sourceSessionIds: ['session_01'],
  messageRangeChecksum: 'a'.repeat(64),
  contentSha256: 'b'.repeat(64),
};

describe('lesson closure workflow', () => {
  it('persists lesson closure without waiting for Review task submission', async () => {
    const submitReview = vi.fn().mockRejectedValue(new Error('review_queue_unavailable'));
    const { workflow, closureRepository } = await fixture(false, undefined, submitReview);

    await expect(workflow.begin(snapshot)).resolves.toMatchObject({
      transactionId: 'closure_01',
      state: 'open',
    });
    await expect(closureRepository.get('closure_01')).resolves.toMatchObject({
      state: 'open',
      generationTaskId: 'pending',
    });
    expect(submitReview).not.toHaveBeenCalled();
  });

  it('reuses the same closure snapshot instead of creating duplicate Review tasks', async () => {
    const submitReview = vi.fn().mockResolvedValue({ taskId: 'task_01' });
    const { workflow } = await fixture(false, undefined, submitReview);

    const first = await workflow.begin(snapshot);
    const second = await workflow.begin(snapshot);

    expect(second.transactionId).toBe(first.transactionId);
    expect(submitReview).not.toHaveBeenCalled();
  });

  it('does not submit a second Review task while the current attempt is generating', async () => {
    const submitReview = vi.fn().mockResolvedValue({ taskId: 'task_01' });
    const { workflow } = await fixture(false, undefined, submitReview);
    const started = await workflow.begin(snapshot);

    const generating = await workflow.retry(started.transactionId, 'initial');
    const duplicateRetry = await workflow.retry(started.transactionId, 'duplicate');

    expect(duplicateRetry).toEqual(generating);
    expect(submitReview).toHaveBeenCalledTimes(1);
  });

  it('rejects a late Review write after permanent course deletion starts', async () => {
    let deleted = false;
    const { workflow, closureRepository } = await fixture(false, async () => {
      if (deleted) {
        throw Object.assign(new Error('resource_not_found'), { code: 'resource_not_found' });
      }
    });
    await workflow.begin(snapshot);
    deleted = true;

    await expect(workflow.markReviewReady('closure_01', review)).rejects.toMatchObject({
      code: 'resource_not_found',
    });
    await expect(closureRepository.get('closure_01')).resolves.toMatchObject({
      state: 'open',
    });
  });

  it('rejects an empty source session and retains a retryable generation failure', async () => {
    const { workflow, closureRepository } = await fixture();
    await expect(workflow.begin({ ...snapshot, sourceMessageIds: [] })).rejects.toMatchObject({
      code: 'lesson_not_completable',
    });
    const started = await workflow.begin(snapshot);
    await workflow.retry(started.transactionId, 'initial_closure_01');
    await workflow.fail(started.transactionId, 'ai_unavailable', 'draft_01');
    await expect(closureRepository.get(started.transactionId)).resolves.toMatchObject({
      state: 'generating-failed',
      errorCode: 'ai_unavailable',
      draftArtifactRef: 'draft_01',
    });
    await expect(workflow.retry(started.transactionId, 'retry_01')).resolves.toMatchObject({
      transactionId: 'closure_01',
      state: 'generating',
    });
  });

  it('[EQ-LESSON-04] rejects tampered source checksums and makes a completed final Review immutable', async () => {
    const { workflow, sessionModule } = await fixture();
    const started = await workflow.begin(snapshot);
    await workflow.retry(started.transactionId, 'initial_closure_01');
    await workflow.markReviewReady(started.transactionId, review);
    await expect(
      workflow.commit(started.transactionId, 'c'.repeat(64), {
        ...baseContext,
        commandId: 'commit',
        expectedVersion: 2,
      }),
    ).rejects.toMatchObject({ code: 'source_snapshot_changed' });
    await workflow.commit(started.transactionId, 'a'.repeat(64), {
      ...baseContext,
      commandId: 'commit',
      expectedVersion: 2,
    });
    await expect(
      sessionModule.query(
        { type: 'GetLessonLearning', lessonId: 'lesson_01' },
        { ...baseContext, correlationId: 'query' },
      ),
    ).resolves.toMatchObject({
      learning: {
        progress: 'completed',
        session: { state: 'closed', finalReviewId: 'review_final_01' },
      },
      finalReview: {
        id: 'review_final_01',
        artifactRef: 'artifact:final-review',
      },
    });
    await expect(workflow.retry(started.transactionId, 'late_retry')).rejects.toMatchObject({
      code: 'final_review_immutable',
    });
  });

  it('[EQ-LESSON-12] recovers a crash after the LearningSession commit without duplicating the final artifact', async () => {
    const { workflow, closureRepository, sessionModule } = await fixture(true);
    const started = await workflow.begin(snapshot);
    await workflow.retry(started.transactionId, 'initial_closure_01');
    await workflow.markReviewReady(started.transactionId, review);
    await expect(
      workflow.commit(started.transactionId, snapshot.messageRangeChecksum, {
        ...baseContext,
        commandId: 'commit',
        expectedVersion: 2,
      }),
    ).rejects.toThrow('simulated crash');
    await expect(closureRepository.get(started.transactionId)).resolves.toMatchObject({
      state: 'committing',
      finalReviewId: 'review_final_01',
    });
    await workflow.recover(started.transactionId, snapshot.messageRangeChecksum, {
      ...baseContext,
      commandId: 'recovery_uses_a_new_http_command',
      expectedVersion: 3,
    });
    await expect(closureRepository.get(started.transactionId)).resolves.toMatchObject({
      state: 'completed',
      finalReviewId: 'review_final_01',
    });
    const view = await sessionModule.query(
      { type: 'GetLessonLearning', lessonId: 'lesson_01' },
      { ...baseContext, correlationId: 'query' },
    );
    expect(view.learning.session?.finalReviewId).toBe('review_final_01');
    expect(view.resourceVersion).toBe(4);
  });

  it('[EQ-LESSON-12] persists the close snapshot before generation and allows cancellation before commit', async () => {
    const { workflow, closureRepository, sessionModule } = await fixture();
    const started = await workflow.begin(snapshot);
    await expect(closureRepository.get(started.transactionId)).resolves.toMatchObject({
      state: 'open',
      sourceMessageIds: ['message_01'],
      messageRangeChecksum: snapshot.messageRangeChecksum,
      endIntent: snapshot.endIntent,
    });
    await expect(workflow.cancel(started.transactionId)).resolves.toMatchObject({
      state: 'cancelled',
    });
    await expect(
      workflow.recover(started.transactionId, snapshot.messageRangeChecksum, {
        ...baseContext,
        commandId: 'recover_cancelled',
      }),
    ).resolves.toMatchObject({
      state: 'cancelled',
    });
    await expect(
      sessionModule.query(
        { type: 'GetLessonLearning', lessonId: 'lesson_01' },
        { ...baseContext, correlationId: 'query_cancelled' },
      ),
    ).resolves.toMatchObject({ learning: { progress: 'in_progress' } });
  });

  it('keeps supplementary learning separate from the original final Review', () => {
    const supplementary = createSupplementarySession({
      id: 'supplementary_01',
      courseId: 'course_01',
      lessonId: 'lesson_01',
      finalReviewId: 'review_final_01',
      createdAt: '2026-07-13T00:02:00.000Z',
    });
    expect(supplementary).toMatchObject({
      id: 'supplementary_01',
      sourceFinalReviewId: 'review_final_01',
      status: 'active',
      messageIds: [],
    });
    expect(supplementary).not.toHaveProperty('originalSessionId');
  });
});
