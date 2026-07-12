import type { LearningEventEnvelope } from '@learning-more/contracts';

import type { Outbox } from '../../../persistence/outbox.js';
import { RepositoryVersionConflictError } from '../../../persistence/repository-errors.js';
import type { UnitOfWork } from '../../../persistence/unit-of-work.js';
import type { CourseReviewInputManifest } from '../../review-closure/interface.js';
import type { CourseCreationRepositories } from '../ports/course-repositories.js';

type LessonState = 'not_started' | 'in_progress' | 'abandoned' | 'completed';

class CourseNotClosableError extends Error {
  readonly code = 'course_not_closable';
  constructor(readonly blockers: readonly { lessonId: string; state: LessonState }[]) {
    super('course_not_closable');
    this.name = 'CourseNotClosableError';
  }
}

class AbandonedConfirmationRequiredError extends Error {
  readonly code = 'abandoned_confirmation_required';
}

export async function closeCourse(
  command: {
    courseId: string;
    expectedVersion: number;
    confirmAbandoned: boolean;
    idempotencyKey: string;
  },
  dependencies: {
    repositories: CourseCreationRepositories;
    unitOfWork: UnitOfWork;
    getLessonState(lessonId: string): Promise<LessonState>;
    inputManifest: CourseReviewInputManifest;
    outbox?: Outbox;
    now: () => Date;
    nextEventId: () => string;
  },
) {
  const course = await dependencies.repositories.courses.get(command.courseId);
  if (course === undefined) throw new Error('COURSE_NOT_FOUND');
  if (course.status === 'closed') {
    return {
      courseId: course.id,
      repeated: true,
      abandonedLessonIds: [] as string[],
      inputManifest: dependencies.inputManifest,
      resourceVersion: course.resourceVersion,
    };
  }
  if (course.resourceVersion !== command.expectedVersion) {
    throw new RepositoryVersionConflictError(course.resourceVersion);
  }
  const states = await Promise.all(
    course.lessonIds.map(async (lessonId) => ({
      lessonId,
      state: await dependencies.getLessonState(lessonId),
    })),
  );
  const blockers = states.filter(
    (item): item is { lessonId: string; state: 'not_started' | 'in_progress' } =>
      item.state === 'not_started' || item.state === 'in_progress',
  );
  if (blockers.length > 0) throw new CourseNotClosableError(blockers);
  const abandonedLessonIds = states
    .filter((item) => item.state === 'abandoned')
    .map((item) => item.lessonId);
  if (abandonedLessonIds.length > 0 && !command.confirmAbandoned) {
    throw new AbandonedConfirmationRequiredError('abandoned_confirmation_required');
  }
  const closedAt = dependencies.now().toISOString();
  const event: LearningEventEnvelope = {
    id: dependencies.nextEventId(),
    schema_version: 1,
    type: 'CourseClosed',
    occurred_at: closedAt,
    recorded_at: closedAt,
    source: 'CourseAuthoring',
    target_refs: { courseId: course.id },
    payload: { abandonedLessonIds },
    idempotency_key: command.idempotencyKey,
    correlation_id: command.idempotencyKey,
  };
  await dependencies.unitOfWork.execute(
    { transactionId: `tx_close_course_${course.id}` },
    async (tx) => {
      await dependencies.repositories.courses.save(
        tx,
        { ...course, status: 'closed', closedAt },
        course.resourceVersion,
      );
      await dependencies.outbox?.enqueue(tx, [event]);
    },
  );
  return {
    courseId: course.id,
    repeated: false,
    abandonedLessonIds,
    inputManifest: dependencies.inputManifest,
    resourceVersion: course.resourceVersion + 1,
  };
}
