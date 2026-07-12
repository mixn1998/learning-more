import type { CommandContext } from '@learning-more/contracts';

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
  | Readonly<{ type: 'RemoveScheduleItem'; scheduleItemId: string }>;

export type PlanningResult = Readonly<{ scheduleItem: ScheduleItem }>;

export interface PlanningModule {
  execute(command: PlanningCommand, context: CommandContext): Promise<PlanningResult>;
  list(): Promise<readonly ScheduleItem[]>;
}
