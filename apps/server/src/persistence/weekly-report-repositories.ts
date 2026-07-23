import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import type {
  WeeklyReportRecord,
  WeeklyReportRepository,
} from '../modules/learning-facts/ports/weekly-report-repository.js';
import { DataRoot } from './data-root.js';
import { checksumJson, decodeAggregateDocument } from './json-codec.js';
import { createStorePaths } from './paths.js';
import { RepositoryVersionConflictError } from './repository-errors.js';

const checksum = z.string().regex(/^[a-f0-9]{64}$/);
const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const SnapshotEntrySchema = z.strictObject({
  factId: z.string().min(1),
  sourceRef: z.string().min(1).optional(),
  kind: z
    .enum([
      'learning-session',
      'teaching-ledger',
      'review',
      'plan-change',
      'reasoning-evidence',
      'fact',
    ])
    .optional(),
  occurredAt: z.iso.datetime({ offset: true }),
  summary: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  courseId: z.string().min(1).optional(),
  lessonId: z.string().min(1).optional(),
  actualSeconds: z.number().nonnegative(),
  disciplineTag: z.string().min(1).optional(),
  topicTags: z.array(z.string()),
});
const WeeklyReportSchema = z.strictObject({
  localWeekKey: z.string().regex(/^\d{4}-W\d{2}$/),
  timezone: z.string().min(1),
  startLocalDate: localDate,
  endLocalDate: localDate,
  state: z.enum(['generating', 'failed', 'finalized']),
  factSnapshot: z.array(SnapshotEntrySchema),
  factSnapshotHash: checksum,
  sourceRefs: z.array(z.string()).optional(),
  snapshotExclusions: z.array(z.string()).optional(),
  projectionCursor: z.string().min(1).optional(),
  metricDefinitionVersion: z.number().int().positive(),
  generationTaskId: z.string().min(1),
  attemptCount: z.number().int().positive().optional(),
  nextRetryAt: z.iso.datetime({ offset: true }).optional(),
  artifactRef: z.string().min(1).optional(),
  contentSha256: checksum.optional(),
  errorCode: z.string().min(1).optional(),
  draftArtifactRef: z.string().min(1).optional(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  resourceVersion: z.number().int().nonnegative(),
});

export function createLocalFileWeeklyReportRepository(dataRoot: DataRoot): WeeklyReportRepository {
  const paths = createStorePaths(dataRoot);
  async function stageRecord(
    tx: Parameters<WeeklyReportRepository['save']>[0],
    record: WeeklyReportRecord,
    expectedVersion: number,
  ): Promise<void> {
    const data = { ...record, resourceVersion: expectedVersion + 1 };
    const absolute = paths.aggregate('weekly-reports', record.localWeekKey);
    await tx.stageJson(path.relative(dataRoot.absolutePath, absolute).replaceAll('\\', '/'), {
      schema: 'learning-more/weekly-report',
      schemaVersion: 1,
      entityType: 'weekly-reports',
      entityId: record.localWeekKey,
      resourceVersion: expectedVersion + 1,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      contentSha256: checksumJson(data),
      data,
    });
  }
  const repository: WeeklyReportRepository = {
    async get(localWeekKey) {
      try {
        return decodeAggregateDocument(
          await readFile(paths.aggregate('weekly-reports', localWeekKey), 'utf8'),
          WeeklyReportSchema,
        ).data as WeeklyReportRecord;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
      }
    },
    async save(tx, record, expectedVersion) {
      const current = await repository.get(record.localWeekKey);
      if (current?.state === 'finalized') {
        throw Object.assign(new Error('weekly_report_immutable'), {
          code: 'weekly_report_immutable',
        });
      }
      const currentVersion = current?.resourceVersion ?? 0;
      if (currentVersion !== expectedVersion || record.resourceVersion !== expectedVersion) {
        throw new RepositoryVersionConflictError(currentVersion);
      }
      await stageRecord(tx, record, expectedVersion);
    },
    async replaceInvalidWindow(tx, record, expectedVersion) {
      const current = await repository.get(record.localWeekKey);
      if (current === undefined) throw new Error('weekly_report_not_found');
      if (
        current.startLocalDate === record.startLocalDate &&
        current.endLocalDate === record.endLocalDate
      ) {
        throw new Error('weekly_report_window_unchanged');
      }
      if (
        current.resourceVersion !== expectedVersion ||
        record.resourceVersion !== expectedVersion
      ) {
        throw new RepositoryVersionConflictError(current.resourceVersion);
      }
      await stageRecord(tx, record, expectedVersion);
    },
    async replaceInvalidOutput(tx, record, expectedVersion, expectedContentSha256) {
      const current = await repository.get(record.localWeekKey);
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
      await stageRecord(tx, record, expectedVersion);
    },
    async *list() {
      const root = path.join(dataRoot.absolutePath, 'entities', 'weekly-reports');
      const ids: string[] = [];
      for (const shard of await readdir(root, { withFileTypes: true }).catch(() => [])) {
        if (!shard.isDirectory()) continue;
        for (const file of await readdir(path.join(root, shard.name), { withFileTypes: true })) {
          if (file.isFile() && file.name.endsWith('.json')) ids.push(file.name.slice(0, -5));
        }
      }
      for (const id of ids.sort()) {
        const report = await repository.get(id);
        if (report !== undefined) yield report;
      }
    },
  };
  return repository;
}
