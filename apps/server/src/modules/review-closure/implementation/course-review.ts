import { randomUUID } from 'node:crypto';

import type { LearningEventEnvelope } from '@learning-more/contracts';

import type { Outbox } from '../../../persistence/outbox.js';
import {
  ImmutableResourceError,
  RepositoryVersionConflictError,
} from '../../../persistence/repository-errors.js';
import type { UnitOfWork } from '../../../persistence/unit-of-work.js';
import type {
  CourseReviewInputManifest,
  CourseReviewRecord,
  CourseReviewRepository,
} from '../interface.js';

export function createInMemoryCourseReviewRepository(): CourseReviewRepository {
  const records = new Map<string, CourseReviewRecord>();
  return {
    get: async (courseId) => structuredClone(records.get(courseId)),
    async save(_tx, record, expectedVersion) {
      const current = records.get(record.courseId)?.resourceVersion ?? 0;
      if (current !== expectedVersion || record.resourceVersion !== expectedVersion) {
        throw new RepositoryVersionConflictError(current);
      }
      if (records.get(record.courseId)?.state === 'review-finalized') {
        throw new ImmutableResourceError();
      }
      records.set(
        record.courseId,
        structuredClone({ ...record, resourceVersion: expectedVersion + 1 }),
      );
    },
    async *list() {
      for (const id of [...records.keys()].sort()) yield structuredClone(records.get(id)!);
    },
  };
}

export function createCourseReviewWorkflow(options: {
  repository: CourseReviewRepository;
  unitOfWork: UnitOfWork;
  reviewTask: {
    submit(input: {
      courseId: string;
      inputManifest: CourseReviewInputManifest;
      commandId: string;
    }): Promise<{ taskId: string }>;
  };
  now: () => Date;
  outbox?: Outbox;
  nextEventId?: () => string;
  assertCourseWritable?: (courseId: string) => Promise<void>;
}) {
  const save = async (record: CourseReviewRecord) => {
    await options.unitOfWork.execute(
      { transactionId: `tx_course_review_${randomUUID()}` },
      async (tx) => {
        await options.assertCourseWritable?.(record.courseId);
        await options.repository.save(tx, record, record.resourceVersion);
      },
    );
    return (await options.repository.get(record.courseId))!;
  };
  const submit = async (
    courseId: string,
    inputManifest: CourseReviewInputManifest,
    commandId: string,
  ) => {
    const task = await options.reviewTask.submit({
      courseId,
      inputManifest,
      commandId,
    });
    return task.taskId;
  };
  return {
    async request(courseId: string, inputManifest: CourseReviewInputManifest, commandId: string) {
      const existing = await options.repository.get(courseId);
      if (existing?.state === 'review-finalized') throw new ImmutableResourceError();
      const sameManifest =
        existing !== undefined &&
        JSON.stringify(existing.inputManifest) === JSON.stringify(inputManifest);
      if (
        sameManifest &&
        (existing?.state === 'generating-review' || existing?.state === 'review-ready')
      ) {
        return existing;
      }
      const generationTaskId = await submit(courseId, inputManifest, commandId);
      return save({
        courseId,
        state: 'generating-review',
        inputManifest,
        generationTaskId,
        resourceVersion: existing?.resourceVersion ?? 0,
      });
    },
    async fail(courseId: string, errorCode: string, draftArtifactRef: string) {
      const current = await options.repository.get(courseId);
      if (current === undefined) throw new Error('COURSE_REVIEW_NOT_FOUND');
      return save({ ...current, state: 'review-failed', errorCode, draftArtifactRef });
    },
    async retry(courseId: string, commandId: string) {
      const current = await options.repository.get(courseId);
      if (current === undefined) throw new Error('COURSE_REVIEW_NOT_FOUND');
      if (current.state === 'review-finalized') throw new ImmutableResourceError();
      const generationTaskId = await submit(courseId, current.inputManifest, commandId);
      const { errorCode: _error, draftArtifactRef: _draft, ...rest } = current;
      void _error;
      void _draft;
      return save({ ...rest, state: 'generating-review', generationTaskId });
    },
    async markReady(
      courseId: string,
      artifactRef: string,
      contentSha256: string,
      document?: CourseReviewRecord['document'],
    ) {
      const current = await options.repository.get(courseId);
      if (current === undefined) throw new Error('COURSE_REVIEW_NOT_FOUND');
      return save({
        ...current,
        state: 'review-ready',
        artifactRef,
        contentSha256,
        ...(document === undefined ? {} : { document }),
      });
    },
    async finalize(courseId: string, idempotencyKey: string) {
      const current = await options.repository.get(courseId);
      if (current?.state === 'review-finalized') throw new ImmutableResourceError();
      if (current?.state !== 'review-ready') throw new Error('COURSE_REVIEW_NOT_READY');
      const finalized = { ...current, state: 'review-finalized' as const };
      const timestamp = options.now().toISOString();
      const event: LearningEventEnvelope = {
        id: options.nextEventId?.() ?? `event_${randomUUID()}`,
        schema_version: 1,
        type: 'CourseReviewFinalized',
        occurred_at: timestamp,
        recorded_at: timestamp,
        source: 'ReviewClosure',
        target_refs: { courseId },
        payload: { artifactRef: current.artifactRef },
        idempotency_key: idempotencyKey,
        correlation_id: idempotencyKey,
      };
      await options.unitOfWork.execute(
        { transactionId: `tx_course_review_${randomUUID()}` },
        async (tx) => {
          await options.assertCourseWritable?.(courseId);
          await options.repository.save(tx, finalized, current.resourceVersion);
          await options.outbox?.enqueue(tx, [event]);
        },
      );
      return (await options.repository.get(courseId))!;
    },
  };
}
