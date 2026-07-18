import type { CommandContext } from '@learning-more/contracts';

import type { TransactionContext } from '../../persistence/unit-of-work.js';
import type { ScheduleItem, ScheduleSource } from './model/schedule-item.js';

export type PlanningCommand =
  | Readonly<{
      type: 'CreateScheduleItem';
      courseId: string;
      lessonId: string;
      startAt: string;
      endAt: string;
      timezoneAtCreation: string;
      source: ScheduleSource;
    }>
  | Readonly<{
      type: 'MoveScheduleItem';
      scheduleItemId: string;
      startAt: string;
      endAt: string;
    }>
  | Readonly<{
      type: 'ResizeScheduleItem';
      scheduleItemId: string;
      endAt: string;
    }>
  | Readonly<{ type: 'SetScheduleLock'; scheduleItemId: string; locked: boolean }>
  | Readonly<{ type: 'RemoveScheduleItem'; scheduleItemId: string }>;

export type PlanningResult = Readonly<{ scheduleItem: ScheduleItem }>;
export type PlanningClearResult = Readonly<{
  removedItems: readonly ScheduleItem[];
  resourceVersion: number;
}>;
export type PlanningScheduleSnapshot = Readonly<{
  items: readonly ScheduleItem[];
  resourceVersion: number;
}>;

export type PlanningOutlineRevisionInput = Readonly<{
  courseId: string;
  retainedLessonIds: readonly string[];
  knownCourseLessonIds: readonly string[];
  commandId: string;
  occurredAt: string;
}>;

export interface PlanningOutlineRevisionParticipant {
  retireOutlineReferences(
    input: PlanningOutlineRevisionInput,
    tx: TransactionContext,
  ): Promise<void>;
}

export interface PlanningModule {
  execute(command: PlanningCommand, context: CommandContext): Promise<PlanningResult>;
  clearAll(context: CommandContext): Promise<PlanningClearResult>;
  snapshot(): Promise<PlanningScheduleSnapshot>;
  list(): Promise<readonly ScheduleItem[]>;
  getVersion(): Promise<number>;
}
