import type { CommandResult } from '@learning-more/contracts';

import type { TransactionContext } from '../../../persistence/unit-of-work.js';
import type { CourseArchiveDeletedResult } from '../interface.js';

export type CourseArchiveDeletionManifest = Readonly<{
  courseId: string;
  deletedCounts: Readonly<Record<string, number>>;
}>;

export type CourseArchiveDeletionReceipt = Readonly<{
  idempotencyKey: string;
  requestHash: string;
  courseId: string;
  result: CommandResult<CourseArchiveDeletedResult>;
}>;

export interface CourseArchiveStore {
  getCourse(
    courseId: string,
  ): Promise<Readonly<{ courseId: string; resourceVersion: number }> | undefined>;
  getReceipt(idempotencyKey: string): Promise<CourseArchiveDeletionReceipt | undefined>;
  stageDelete(tx: TransactionContext, courseId: string): Promise<CourseArchiveDeletionManifest>;
  saveReceipt(tx: TransactionContext, receipt: CourseArchiveDeletionReceipt): Promise<void>;
}
