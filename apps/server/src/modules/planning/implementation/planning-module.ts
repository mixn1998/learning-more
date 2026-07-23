import { randomUUID } from 'node:crypto';

import type { CommandContext } from '@learning-more/contracts';

import { RepositoryVersionConflictError } from '../../../persistence/repository-errors.js';
import type { TransactionContext, UnitOfWork } from '../../../persistence/unit-of-work.js';
import type { PlanningCommand, PlanningModule } from '../interface.js';
import {
  type ScheduleItem,
  ScheduleRuleError,
  validateScheduleInterval,
  validateTimeZone,
} from '../model/schedule-item.js';
import type { ScheduleRepository } from '../ports/schedule-repository.js';
import type { ScheduleIndex } from './schedule-index.js';

class PlanningError extends Error {
  constructor(
    readonly code: 'lesson_not_plannable' | 'schedule_not_found' | 'schedule_conflict',
    readonly conflictingItemIds?: readonly string[],
  ) {
    super(code);
    this.name = 'PlanningError';
  }
}

type ScheduleEvent = Readonly<{
  type: 'SchedulePlanned' | 'ScheduleChanged' | 'ScheduleCancelled';
  scheduleItemId: string;
  courseId: string;
  lessonId: string;
  occurredAt: string;
}>;

export function createPlanningModule(options: {
  repository: ScheduleRepository;
  scheduleIndex?: ScheduleIndex;
  unitOfWork: UnitOfWork;
  getLessonProgress(
    lessonId: string,
  ): Promise<'not_started' | 'in_progress' | 'abandoned' | 'completed' | undefined>;
  nextScheduleItemId(): string;
  now(): Date;
  recordEvent?(event: ScheduleEvent, tx: TransactionContext): Promise<void>;
}): PlanningModule {
  async function all(): Promise<ScheduleItem[]> {
    if (options.scheduleIndex !== undefined) {
      return [...(await options.scheduleIndex.current()).items];
    }
    const items: ScheduleItem[] = [];
    for await (const item of options.repository.list()) items.push(item);
    return items.sort((left, right) =>
      left.startAt === right.startAt
        ? left.id.localeCompare(right.id)
        : left.startAt.localeCompare(right.startAt),
    );
  }

  async function conflictIds(candidate: ScheduleItem): Promise<readonly string[]> {
    const candidates =
      options.scheduleIndex === undefined
        ? await all()
        : (await options.scheduleIndex.current()).forLesson(candidate.lessonId);
    return candidates
      .filter(
        (item) =>
          item.id !== candidate.id &&
          item.status === 'scheduled' &&
          item.lessonId === candidate.lessonId,
      )
      .map((item) => item.id);
  }

  async function aggregateVersion(): Promise<number> {
    if (options.scheduleIndex !== undefined) {
      return (await options.scheduleIndex.current()).resourceVersion;
    }
    return (await all()).reduce((total, item) => total + item.resourceVersion, 0);
  }

  async function snapshot() {
    if (options.scheduleIndex !== undefined) {
      const index = await options.scheduleIndex.current();
      return { items: index.scheduled, resourceVersion: index.resourceVersion };
    }
    const items = await all();
    return {
      items: items.filter((item) => item.status === 'scheduled'),
      resourceVersion: items.reduce((total, item) => total + item.resourceVersion, 0),
    };
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
        const progress = await options.getLessonProgress(item.lessonId);
        if (progress === undefined || progress === 'completed' || progress === 'abandoned') {
          throw new PlanningError('lesson_not_plannable');
        }
        await options.repository.save(tx, item, item.resourceVersion);
        await options.recordEvent?.(
          {
            type: eventType,
            scheduleItemId: item.id,
            courseId: item.courseId,
            lessonId: item.lessonId,
            occurredAt: options.now().toISOString(),
          },
          tx,
        );
      },
    );
    return (await options.repository.get(item.id))!;
  }

  return {
    async execute(command: PlanningCommand, context: CommandContext) {
      const existingReceipt =
        options.scheduleIndex === undefined
          ? (await all()).find((item) => item.processedCommandIds.includes(context.commandId))
          : (await options.scheduleIndex.current()).forCommand(context.commandId)[0];
      if (existingReceipt !== undefined) return { scheduleItem: existingReceipt };

      if (command.type === 'CreateScheduleItem') {
        validateScheduleInterval(command.startAt, command.endAt);
        validateTimeZone(command.timezoneAtCreation);
        const progress = await options.getLessonProgress(command.lessonId);
        if (progress === undefined || progress === 'completed' || progress === 'abandoned') {
          throw new PlanningError('lesson_not_plannable');
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
          locked: false,
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
      const progress = await options.getLessonProgress(current.lessonId);
      if (progress === undefined || progress === 'completed' || progress === 'abandoned') {
        throw new PlanningError('lesson_not_plannable');
      }

      const next: ScheduleItem = {
        ...current,
        ...(command.type === 'MoveScheduleItem'
          ? { startAt: command.startAt, endAt: command.endAt }
          : command.type === 'ResizeScheduleItem'
            ? { endAt: command.endAt }
            : command.type === 'SetScheduleLock'
              ? { locked: command.locked }
              : { status: 'removed' as const, cancelReason: 'user_removed' as const }),
        ...((command.type === 'MoveScheduleItem' || command.type === 'ResizeScheduleItem') &&
        current.source === 'plan-flow'
          ? { locked: true }
          : {}),
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
    async clear(scheduleItemIds: readonly string[], context: CommandContext) {
      const indexed = await options.scheduleIndex?.current();
      const items = indexed?.items ?? (await all());
      const existingReceipt =
        indexed?.forCommand(context.commandId) ??
        items.filter((item) => item.processedCommandIds.includes(context.commandId));
      if (existingReceipt.length > 0) {
        return { removedItems: existingReceipt, resourceVersion: await aggregateVersion() };
      }
      const currentVersion = items.reduce((total, item) => total + item.resourceVersion, 0);
      if (context.expectedVersion !== currentVersion) {
        throw new RepositoryVersionConflictError(currentVersion);
      }
      const timestamp = options.now().toISOString();
      const selectedIds = new Set(scheduleItemIds);
      const scheduled = items.filter(
        (item) => item.status === 'scheduled' && selectedIds.has(item.id),
      );
      if (scheduled.length === 0) return { removedItems: [], resourceVersion: currentVersion };
      await options.unitOfWork.execute(
        { transactionId: `tx_schedule_clear_selection_${randomUUID()}` },
        async (tx) => {
          for (const current of scheduled) {
            const removed: ScheduleItem = {
              ...current,
              status: 'removed',
              cancelReason: 'user_removed',
              updatedAt: timestamp,
              processedCommandIds: [...current.processedCommandIds, context.commandId],
            };
            await options.repository.save(tx, removed, current.resourceVersion);
            await options.recordEvent?.(
              {
                type: 'ScheduleCancelled',
                scheduleItemId: current.id,
                courseId: current.courseId,
                lessonId: current.lessonId,
                occurredAt: timestamp,
              },
              tx,
            );
          }
        },
      );
      const removedItems = await Promise.all(
        scheduled.map((item) => options.repository.get(item.id)),
      );
      return {
        removedItems: removedItems.filter((item): item is ScheduleItem => item !== undefined),
        resourceVersion: await aggregateVersion(),
      };
    },
    snapshot,
    list: () => snapshot().then((view) => view.items),
    getVersion: aggregateVersion,
  };
}
