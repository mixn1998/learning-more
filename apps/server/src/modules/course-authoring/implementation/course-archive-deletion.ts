import { createHash } from 'node:crypto';

import type {
  CommandContext,
  CommandResult,
  LearningEventEnvelope,
} from '@learning-more/contracts';

import { IdempotencyConflictError } from '../../../persistence/idempotency-store.js';
import type { Outbox } from '../../../persistence/outbox.js';
import { RepositoryVersionConflictError } from '../../../persistence/repository-errors.js';
import type { UnitOfWork } from '../../../persistence/unit-of-work.js';
import type { CourseArchiveStore } from '../ports/course-archive-store.js';
import type { CourseArchiveDeletedResult } from '../interface.js';

class CourseArchiveNotFoundError extends Error {
  readonly code = 'resource_not_found';

  constructor() {
    super('resource_not_found');
    this.name = 'CourseArchiveNotFoundError';
  }
}

function requestHash(courseId: string): string {
  return createHash('sha256').update(JSON.stringify({ courseId }), 'utf8').digest('hex');
}

export function createCourseArchiveDeletion(options: {
  store: CourseArchiveStore;
  unitOfWork: UnitOfWork;
  outbox: Outbox;
  nextEventId(): string;
  now(): Date;
}) {
  return {
    async execute(
      command: Readonly<{ courseId: string }>,
      context: CommandContext,
    ): Promise<CommandResult<CourseArchiveDeletedResult>> {
      const hash = requestHash(command.courseId);
      const execution = await options.unitOfWork.execute(
        {
          transactionId: `tx_delete_course_${createHash('sha256').update(context.idempotencyKey).digest('hex')}`,
        },
        async (tx) => {
          const receipt = await options.store.getReceipt(context.idempotencyKey);
          if (receipt !== undefined) {
            if (receipt.requestHash !== hash || receipt.courseId !== command.courseId) {
              throw new IdempotencyConflictError();
            }
            return { result: receipt.result, newlyDeleted: false } as const;
          }

          const course = await options.store.getCourse(command.courseId);
          if (course === undefined) throw new CourseArchiveNotFoundError();
          if (course.resourceVersion !== context.expectedVersion) {
            throw new RepositoryVersionConflictError(course.resourceVersion);
          }

          const deletedAt = options.now().toISOString();
          const manifest = await options.store.stageDelete(tx, command.courseId);
          const result: CommandResult<CourseArchiveDeletedResult> = {
            commandId: context.commandId,
            outcome: 'completed',
            value: {
              kind: 'course-archive-deleted',
              courseId: command.courseId,
              deletedAt,
            },
          };
          const event: LearningEventEnvelope = {
            id: options.nextEventId(),
            schema_version: 1,
            type: 'CourseArchiveDeleted',
            occurred_at: deletedAt,
            recorded_at: deletedAt,
            source: 'CourseAuthoring',
            target_refs: { courseId: command.courseId },
            payload: { deletedCounts: manifest.deletedCounts },
            idempotency_key: context.idempotencyKey,
            correlation_id: context.correlationId,
          };
          await options.outbox.enqueue(tx, [event]);
          await options.store.saveReceipt(tx, {
            idempotencyKey: context.idempotencyKey,
            requestHash: hash,
            courseId: command.courseId,
            result,
          });
          return { result, newlyDeleted: true } as const;
        },
      );

      return execution.result;
    },
  };
}
