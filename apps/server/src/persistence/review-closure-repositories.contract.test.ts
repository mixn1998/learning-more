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
import {
  createLocalFileReviewClosureRepositories,
  lessonClosureIndexRelativePath,
} from './review-closure-repositories.js';
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
  const unitOfWork = createUnitOfWork({ dataRoot });
  const repositories = createLocalFileReviewClosureRepositories(dataRoot, unitOfWork);
  await repositories.lessonClosures.initialize();
  return {
    dataRoot,
    repositories,
    unitOfWork,
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
    await expect(
      repositories.lessonClosures.findLatest('lesson_01', 'session_01'),
    ).resolves.toMatchObject({ transactionId: 'closure_01' });
    await expect(
      repositories.lessonClosures.findBySnapshot('lesson_01', 'session_01', 'b'.repeat(64)),
    ).resolves.toMatchObject({ transactionId: 'closure_01' });
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

  it('backfills legacy Closure indexes once and repairs a corrupt pair index', async () => {
    const { dataRoot, repositories, unitOfWork } = await fixture();
    const closure: LessonClosureRecord = {
      transactionId: 'closure_legacy',
      lessonId: 'lesson_legacy',
      sessionId: 'session_legacy',
      state: 'completed',
      sourceSessionIds: ['session_legacy'],
      sourceMessageIds: ['message_legacy'],
      messageRangeChecksum: 'c'.repeat(64),
      endIntent: 'finish lesson',
      expectedSessionVersion: 4,
      generationTaskId: 'task_legacy',
      updatedAt: '2026-07-14T00:00:00.000Z',
      resourceVersion: 0,
    };
    await unitOfWork.execute({ transactionId: 'tx_seed_legacy_closure' }, (tx) =>
      repositories.lessonClosures.save(tx, closure, 0),
    );
    const indexPath = lessonClosureIndexRelativePath('lesson_legacy', 'session_legacy');
    await unitOfWork.execute({ transactionId: 'tx_remove_closure_indexes' }, async (tx) => {
      await tx.deleteOnCommit(indexPath);
      await tx.deleteOnCommit('indexes/lesson-closures/_complete.json');
    });

    const migrated = createLocalFileReviewClosureRepositories(dataRoot, unitOfWork);
    await migrated.lessonClosures.initialize();
    await expect(
      migrated.lessonClosures.findLatest('lesson_legacy', 'session_legacy'),
    ).resolves.toMatchObject({ transactionId: 'closure_legacy' });

    await unitOfWork.execute({ transactionId: 'tx_corrupt_closure_index' }, (tx) =>
      tx.stageJson(indexPath, { schemaVersion: 999 }),
    );
    const repairing = createLocalFileReviewClosureRepositories(dataRoot, unitOfWork);
    await repairing.lessonClosures.initialize();
    await expect(
      repairing.lessonClosures.findBySnapshot('lesson_legacy', 'session_legacy', 'c'.repeat(64)),
    ).resolves.toMatchObject({ transactionId: 'closure_legacy' });
  });
});
