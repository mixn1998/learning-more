import { describe, expect, it, vi } from 'vitest';

import type {
  LessonClosureRecord,
  StageReviewState,
} from '../../modules/review-closure/model/review-state.js';
import { collectRecoverableReviewProfileCheckpoints } from './review-profile-recovery.js';

function asyncValues<T>(values: readonly T[]): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      yield* values;
    },
  };
}

const finalClosure: LessonClosureRecord = {
  transactionId: 'closure_1',
  lessonId: 'lesson_1',
  sessionId: 'session_final',
  state: 'completed',
  sourceSessionIds: ['session_final'],
  sourceMessageIds: ['message_1'],
  messageRangeChecksum: 'a'.repeat(64),
  endIntent: 'complete',
  expectedSessionVersion: 1,
  generationTaskId: 'task_final',
  review: {
    artifactRef: 'artifact_final',
    markdown: '# Final Review',
    sourceSessionIds: ['session_final'],
    messageRangeChecksum: 'a'.repeat(64),
    contentSha256: 'b'.repeat(64),
  },
  finalReviewId: 'review_final',
  updatedAt: '2026-07-17T10:00:00.000Z',
  resourceVersion: 1,
};

const stageReview: StageReviewState = {
  reviewId: 'review_stage',
  lessonId: 'lesson_2',
  sourceSessionId: 'session_stage',
  sourceSnapshotHash: 'c'.repeat(64),
  status: 'committed',
  taskId: 'task_stage',
  requestReceipts: {},
  artifactRef: 'artifact_stage',
  contentSha256: 'd'.repeat(64),
  replacementCount: 1,
  updatedAt: '2026-07-17T09:00:00.000Z',
  resourceVersion: 1,
};

describe('Review profile checkpoint recovery', () => {
  it('replays the final Review instead of its older stage Review and retains authoritative sessions', async () => {
    const readArtifact = vi.fn(async (artifactId: string) => ({
      content: artifactId === 'artifact_stage' ? '# Stage Review' : '# ignored',
    }));

    const checkpoints = await collectRecoverableReviewProfileCheckpoints({
      stageReviews: asyncValues([
        { ...stageReview, lessonId: 'lesson_1', sourceSessionId: 'session_old_stage' },
        stageReview,
      ]),
      lessonClosures: asyncValues([finalClosure]),
      readArtifact,
      getCourseIdForLesson: async (lessonId) => `course_for_${lessonId}`,
    });

    expect(checkpoints).toEqual([
      expect.objectContaining({
        checkpointKind: 'stage_review_finalized',
        lessonId: 'lesson_2',
        sessionId: 'session_stage',
        markdown: '# Stage Review',
      }),
      expect.objectContaining({
        checkpointKind: 'lesson_review_finalized',
        lessonId: 'lesson_1',
        sessionId: 'session_final',
        markdown: '# Final Review',
      }),
    ]);
    expect(readArtifact).toHaveBeenCalledTimes(1);
  });
});
