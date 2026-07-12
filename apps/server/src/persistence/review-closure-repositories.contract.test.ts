import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type {
  CourseReviewRecord,
  ReviewStateRepository,
} from '../modules/review-closure/interface.js';
import type { LessonClosureRecord } from '../modules/review-closure/model/review-state.js';
import { DataRoot } from './data-root.js';
import { createStorePaths, initializeStoreLayout } from './paths.js';
import { RepositoryVersionConflictError } from './repository-errors.js';
import { createLocalFileReviewClosureRepositories } from './review-closure-repositories.js';
import { createUnitOfWork } from './unit-of-work.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'learning-more-review-repo-'));
  roots.push(directory);
  const dataRoot = DataRoot.create(directory);
  await initializeStoreLayout(createStorePaths(dataRoot));
  return {
    repositories: createLocalFileReviewClosureRepositories(dataRoot),
    unitOfWork: createUnitOfWork({ dataRoot }),
  };
}

describe('ReviewClosure LocalFile repositories', () => {
  it('persists and lists stage Review state with optimistic concurrency', async () => {
    const { repositories, unitOfWork } = await fixture();
    const record: Parameters<ReviewStateRepository['save']>[1] = {
      reviewId: 'review_01',
      lessonId: 'lesson_01',
      sourceSessionId: 'session_01',
      sourceSnapshotHash: 'a'.repeat(64),
      status: 'generating',
      taskId: 'task_01',
      requestReceipts: { command_01: 'task_01' },
      replacementCount: 0,
      updatedAt: '2026-07-13T00:00:00.000Z',
      resourceVersion: 0,
    };
    await unitOfWork.execute({ transactionId: 'tx_stage_create' }, (tx) =>
      repositories.stageReviews.save(tx, record, 0),
    );
    await expect(repositories.stageReviews.get('review_01')).resolves.toMatchObject({
      resourceVersion: 1,
      status: 'generating',
    });
    const ids: string[] = [];
    for await (const review of repositories.stageReviews.list()) ids.push(review.reviewId);
    expect(ids).toEqual(['review_01']);
    await expect(
      unitOfWork.execute({ transactionId: 'tx_stage_stale' }, (tx) =>
        repositories.stageReviews.save(tx, record, 0),
      ),
    ).rejects.toBeInstanceOf(RepositoryVersionConflictError);
  });

  it('persists lesson closing intent and course Review input manifests across restart', async () => {
    const { repositories, unitOfWork } = await fixture();
    const closure: LessonClosureRecord = {
      transactionId: 'closure_01',
      lessonId: 'lesson_01',
      sessionId: 'session_01',
      state: 'committing',
      sourceSessionIds: ['session_01'],
      sourceMessageIds: ['message_01'],
      messageRangeChecksum: 'b'.repeat(64),
      endIntent: 'finish lesson',
      expectedSessionVersion: 3,
      generationTaskId: 'task_02',
      updatedAt: '2026-07-13T00:00:00.000Z',
      resourceVersion: 0,
    };
    const courseReview: CourseReviewRecord = {
      courseId: 'course_01',
      state: 'review-failed',
      inputManifest: {
        outlineVersionId: 'outline_01',
        completedFinalReviewRefs: ['review_final_01'],
        abandonedStageReviewRefs: [],
        abandonedWithoutReviewLessonIds: ['lesson_02'],
      },
      generationTaskId: 'task_03',
      errorCode: 'provider_timeout',
      draftArtifactRef: 'draft_03',
      resourceVersion: 0,
    };
    await unitOfWork.execute({ transactionId: 'tx_closure_create' }, async (tx) => {
      await repositories.lessonClosures.save(tx, closure, 0);
      await repositories.courseReviews.save(tx, courseReview, 0);
    });

    await expect(repositories.lessonClosures.get('closure_01')).resolves.toMatchObject({
      state: 'committing',
      resourceVersion: 1,
    });
    const closureIds: string[] = [];
    for await (const item of repositories.lessonClosures.list()) {
      closureIds.push(item.transactionId);
    }
    expect(closureIds).toEqual(['closure_01']);
    await expect(repositories.courseReviews.get('course_01')).resolves.toMatchObject({
      state: 'review-failed',
      inputManifest: { outlineVersionId: 'outline_01' },
      resourceVersion: 1,
    });
  });
});
