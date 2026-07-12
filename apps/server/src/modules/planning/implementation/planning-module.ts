import { randomUUID } from 'node:crypto';

import type { CommandContext } from '@learning-more/contracts';

import { RepositoryVersionConflictError } from '../../../persistence/repository-errors.js';
import type { TransactionContext, UnitOfWork } from '../../../persistence/unit-of-work.js';
import type { PlanningCommand, PlanningModule } from '../interface.js';
import {
  overlaps,
  type ScheduleItem,
  ScheduleRuleError,
  validateScheduleInterval,
  validateTimeZone,
} from '../model/schedule-item.js';
import type { ScheduleRepository } from '../ports/schedule-repository.js';

class PlanningError extends Error {
  constructor(
    readonly code: 'lesson_completed' | 'schedule_not_found' | 'schedule_conflict',
    readonly conflictingItemIds?: readonly string[],
  ) {
    super(code);
    this.name = 'PlanningError';
  }
}

type ScheduleEvent = Readonly<{
  type: 'SchedulePlanned' | 'ScheduleChanged' | 'ScheduleCancelled';
  scheduleItemId: string;
  occurredAt: string;
}>;

export function createPlanningModule(options: {
  repository: ScheduleRepository;
  unitOfWork: UnitOfWork;
  isLessonCompleted(lessonId: string): Promise<boolean>;
  nextScheduleItemId(): string;
  now(): Date;
  recordEvent?(event: ScheduleEvent, tx: TransactionContext): Promise<void>;
}): PlanningModule {
  async function all(): Promise<ScheduleItem[]> {
    const items: ScheduleItem[] = [];
    for await (const item of options.repository.list()) items.push(item);
    return items.sort((left, right) =>
      left.startAt === right.startAt
        ? left.id.localeCompare(right.id)
        : left.startAt.localeCompare(right.startAt),
    );
  }

  async function conflictIds(candidate: ScheduleItem): Promise<readonly string[]> {
    return (await all())
      .filter(
        (item) =>
          item.id !== candidate.id &&
          item.status === 'scheduled' &&
          item.lessonId === candidate.lessonId &&
          overlaps(item, candidate),
      )
      .map((item) => item.id);
  }

  async function persist(
    item: ScheduleItem,
    eventType: ScheduleEvent['type'],
  ): Promise<ScheduleItem> {
    const conflicts = item.status === 'scheduled' ? await conflictIds(item) : [];
    if (conflicts.length > 0) throw new PlanningError('schedule_conflict', conflicts);
    await options.unitOfWork.execute(
      { transactionId: `tx_schedule_${randomUUID()}` },
      async (tx) => {
        await options.repository.save(tx, item, item.resourceVersion);
        await options.recordEvent?.(
          { type: eventType, scheduleItemId: item.id, occurredAt: options.now().toISOString() },
          tx,
        );
      },
    );
    return (await options.repository.get(item.id))!;
  }

  return {
    async execute(command: PlanningCommand, context: CommandContext) {
      const existingReceipt = (await all()).find((item) =>
        item.processedCommandIds.includes(context.commandId),
      );
      if (existingReceipt !== undefined) return { scheduleItem: existingReceipt };

      if (command.type === 'CreateScheduleItem') {
        validateScheduleInterval(command.startAt, command.endAt);
        validateTimeZone(command.timezoneAtCreation);
        if (await options.isLessonCompleted(command.lessonId)) {
          throw new PlanningError('lesson_completed');
        }
        const timestamp = options.now().toISOString();
        const item: ScheduleItem = {
          id: options.nextScheduleItemId(),
          courseId: command.courseId,
          lessonId: command.lessonId,
          startAt: command.startAt,
          endAt: command.endAt,
          timezoneAtCreation: command.timezoneAtCreation,
          source: command.source,
          status: 'scheduled',
          createdAt: timestamp,
          updatedAt: timestamp,
          processedCommandIds: [context.commandId],
          resourceVersion: 0,
        };
        return { scheduleItem: await persist(item, 'SchedulePlanned') };
      }

      const current = await options.repository.get(command.scheduleItemId);
      if (current === undefined) throw new PlanningError('schedule_not_found');
      if (context.expectedVersion !== current.resourceVersion) {
        throw new RepositoryVersionConflictError(current.resourceVersion);
      }
      if (current.status === 'removed') throw new ScheduleRuleError('schedule_item_removed');
      if (await options.isLessonCompleted(current.lessonId)) {
        throw new PlanningError('lesson_completed');
      }

      const next: ScheduleItem = {
        ...current,
        ...(command.type === 'MoveScheduleItem'
          ? { startAt: command.startAt, endAt: command.endAt }
          : command.type === 'ResizeScheduleItem'
            ? { endAt: command.endAt }
            : { status: 'removed' as const }),
        updatedAt: options.now().toISOString(),
        processedCommandIds: [...current.processedCommandIds, context.commandId],
      };
      if (next.status === 'scheduled') validateScheduleInterval(next.startAt, next.endAt);
      return {
        scheduleItem: await persist(
          next,
          command.type === 'RemoveScheduleItem' ? 'ScheduleCancelled' : 'ScheduleChanged',
        ),
      };
    },
    list: () => all().then((items) => items.filter((item) => item.status === 'scheduled')),
  };
}
