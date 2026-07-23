import { RepositoryVersionConflictError } from '../../../persistence/repository-errors.js';
import type { TransactionContext } from '../../../persistence/unit-of-work.js';

export type WeeklyFactSnapshotEntry = Readonly<{
  factId: string;
  sourceRef?: string;
  kind?:
    | 'learning-session'
    | 'teaching-ledger'
    | 'review'
    | 'plan-change'
    | 'reasoning-evidence'
    | 'fact';
  occurredAt: string;
  summary?: string;
  payload?: Readonly<Record<string, unknown>>;
  courseId?: string;
  lessonId?: string;
  actualSeconds: number;
  disciplineTag?: string;
  topicTags: readonly string[];
}>;

export type WeeklyReportRecord = Readonly<{
  localWeekKey: string;
  timezone: string;
  startLocalDate: string;
  endLocalDate: string;
  state: 'generating' | 'failed' | 'finalized';
  factSnapshot: readonly WeeklyFactSnapshotEntry[];
  factSnapshotHash: string;
  sourceRefs?: readonly string[];
  snapshotExclusions?: readonly string[];
  projectionCursor?: string;
  metricDefinitionVersion: number;
  generationTaskId: string;
  attemptCount?: number;
  nextRetryAt?: string;
  artifactRef?: string;
  contentSha256?: string;
  errorCode?: string;
  draftArtifactRef?: string;
  createdAt: string;
  updatedAt: string;
  resourceVersion: number;
}>;

export interface WeeklyReportRepository {
  get(localWeekKey: string): Promise<WeeklyReportRecord | undefined>;
  save(tx: TransactionContext, record: WeeklyReportRecord, expectedVersion: number): Promise<void>;
  replaceInvalidWindow(
    tx: TransactionContext,
    record: WeeklyReportRecord,
    expectedVersion: number,
  ): Promise<void>;
  replaceInvalidOutput(
    tx: TransactionContext,
    record: WeeklyReportRecord,
    expectedVersion: number,
    expectedContentSha256: string,
  ): Promise<void>;
  list(): AsyncIterable<WeeklyReportRecord>;
}

export function createInMemoryWeeklyReportRepository(): WeeklyReportRepository {
  const records = new Map<string, WeeklyReportRecord>();
  return {
    get: async (key) => structuredClone(records.get(key)),
    async save(_tx, record, expectedVersion) {
      const current = records.get(record.localWeekKey);
      const currentVersion = current?.resourceVersion ?? 0;
      if (current?.state === 'finalized')
        throw Object.assign(new Error('weekly_report_immutable'), {
          code: 'weekly_report_immutable',
        });
      if (currentVersion !== expectedVersion || record.resourceVersion !== expectedVersion) {
        throw new RepositoryVersionConflictError(currentVersion);
      }
      records.set(
        record.localWeekKey,
        structuredClone({ ...record, resourceVersion: expectedVersion + 1 }),
      );
    },
    async replaceInvalidWindow(_tx, record, expectedVersion) {
      const current = records.get(record.localWeekKey);
      const currentVersion = current?.resourceVersion ?? 0;
      if (current === undefined) throw new Error('weekly_report_not_found');
      if (
        current.startLocalDate === record.startLocalDate &&
        current.endLocalDate === record.endLocalDate
      ) {
        throw new Error('weekly_report_window_unchanged');
      }
      if (currentVersion !== expectedVersion || record.resourceVersion !== expectedVersion) {
        throw new RepositoryVersionConflictError(currentVersion);
      }
      records.set(
        record.localWeekKey,
        structuredClone({ ...record, resourceVersion: expectedVersion + 1 }),
      );
    },
    async replaceInvalidOutput(_tx, record, expectedVersion, expectedContentSha256) {
      const current = records.get(record.localWeekKey);
      if (current === undefined) throw new Error('weekly_report_not_found');
      if (
        current.state !== 'finalized' ||
        current.contentSha256 !== expectedContentSha256 ||
        current.startLocalDate !== record.startLocalDate ||
        current.endLocalDate !== record.endLocalDate
      ) {
        throw new Error('weekly_report_output_not_replaceable');
      }
      if (
        current.resourceVersion !== expectedVersion ||
        record.resourceVersion !== expectedVersion
      ) {
        throw new RepositoryVersionConflictError(current.resourceVersion);
      }
      records.set(
        record.localWeekKey,
        structuredClone({ ...record, resourceVersion: expectedVersion + 1 }),
      );
    },
    async *list() {
      for (const key of [...records.keys()].sort()) yield structuredClone(records.get(key)!);
    },
  };
}
