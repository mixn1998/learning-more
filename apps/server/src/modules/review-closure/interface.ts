import type { TransactionContext } from '../../persistence/unit-of-work.js';

import type { LessonClosureRecord, StageReviewState } from './model/review-state.js';

export interface ReviewStateRepository {
  get(reviewId: string): Promise<StageReviewState | undefined>;
  save(tx: TransactionContext, review: StageReviewState, expectedVersion: number): Promise<void>;
  list(): AsyncIterable<StageReviewState>;
}

export interface StageReviewWorkflow {
  request(input: {
    lessonId: string;
    sourceSessionId: string;
    sourceSnapshotHash: string;
    commandId: string;
  }): Promise<{ reviewId: string; taskId: string }>;
  fail(input: {
    reviewId: string;
    taskId: string;
    errorCode: string;
    draftArtifactRef: string;
  }): Promise<void>;
  commit(input: {
    reviewId: string;
    taskId: string;
    artifactRef: string;
    contentSha256: string;
  }): Promise<void>;
}

export interface LessonClosureRepository {
  get(transactionId: string): Promise<LessonClosureRecord | undefined>;
  save(
    tx: TransactionContext,
    closure: LessonClosureRecord,
    expectedVersion: number,
  ): Promise<void>;
}
