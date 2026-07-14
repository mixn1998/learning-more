import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import type { PlanFlow } from '../modules/planning/model/plan-flow.js';
import type { ScheduleItem } from '../modules/planning/model/schedule-item.js';
import type { PlanFlowRepository } from '../modules/planning/ports/plan-flow-repository.js';
import type { ScheduleRepository } from '../modules/planning/ports/schedule-repository.js';
import { DataRoot } from './data-root.js';
import { checksumJson, decodeAggregateDocument } from './json-codec.js';
import { createStorePaths } from './paths.js';
import { RepositoryVersionConflictError } from './repository-errors.js';

const ScheduleItemSchema = z.strictObject({
  id: z.string().min(1),
  courseId: z.string().min(1),
  lessonId: z.string().min(1),
  startAt: z.iso.datetime({ offset: true }),
  endAt: z.iso.datetime({ offset: true }),
  timezoneAtCreation: z.string().min(1),
  source: z.enum(['manual', 'plan-flow']),
  status: z.enum(['scheduled', 'removed']),
  locked: z.boolean().optional(),
  cancelReason: z.enum(['lesson_abandoned', 'user_removed']).optional(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  processedCommandIds: z.array(z.string().min(1)),
  resourceVersion: z.number().int().nonnegative(),
});

const PlanSuggestionSchema = z.strictObject({
  courseId: z.string().min(1),
  lessonId: z.string().min(1),
  startAt: z.iso.datetime({ offset: true }),
  endAt: z.iso.datetime({ offset: true }),
  timezoneAtCreation: z.string().min(1),
  explanation: z.string(),
});

const PlanFlowSchema = z.strictObject({
  id: z.string().min(1),
  state: z.enum([
    'draft',
    'previewing',
    'preview-ready',
    'confirming',
    'confirmed',
    'failed',
    'cancelled',
  ]),
  lifecycleState: z.enum(['active', 'paused', 'deleted']).optional(),
  constraintsArtifactRef: z.string().min(1),
  courseRefs: z.array(z.string().min(1)),
  lessonRefs: z.array(z.string().min(1)),
  timeWindowRefs: z.array(z.string().min(1)),
  existingScheduleSnapshotRef: z.string().min(1),
  baseScheduleVersion: z.number().int().nonnegative(),
  inputSnapshotHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  warnings: z.array(z.string()).optional(),
  generationTaskId: z.string().min(1),
  suggestions: z.array(PlanSuggestionSchema),
  conflicts: z.array(z.string().min(1)),
  confirmationReceipts: z.record(z.string().min(1), z.array(z.string().min(1))),
  confirmedScheduleItemIds: z.array(z.string().min(1)),
  processedCommandIds: z.array(z.string().min(1)).optional(),
  source: z.literal('plan-flow'),
  errorCode: z.string().min(1).optional(),
  draftArtifactRef: z.string().min(1).optional(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  resourceVersion: z.number().int().nonnegative(),
});

export function createLocalFileScheduleRepository(dataRoot: DataRoot): ScheduleRepository {
  const paths = createStorePaths(dataRoot);
  const repository: ScheduleRepository = {
    async get(id) {
      try {
        return decodeAggregateDocument(
          await readFile(paths.aggregate('schedules', id), 'utf8'),
          ScheduleItemSchema,
        ).data as ScheduleItem;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
      }
    },
    async save(tx, item, expectedVersion) {
      const currentVersion = (await repository.get(item.id))?.resourceVersion ?? 0;
      if (currentVersion !== expectedVersion || item.resourceVersion !== expectedVersion) {
        throw new RepositoryVersionConflictError(currentVersion);
      }
      const data = { ...item, resourceVersion: expectedVersion + 1 };
      const absolute = paths.aggregate('schedules', item.id);
      await tx.stageJson(path.relative(dataRoot.absolutePath, absolute).replaceAll('\\', '/'), {
        schema: 'learning-more/schedule-item',
        schemaVersion: 1,
        entityType: 'schedules',
        entityId: item.id,
        resourceVersion: expectedVersion + 1,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        contentSha256: checksumJson(data),
        data,
      });
    },
    async *list() {
      const root = path.join(dataRoot.absolutePath, 'entities', 'schedules');
      const ids: string[] = [];
      for (const shard of await readdir(root, { withFileTypes: true }).catch(() => [])) {
        if (!shard.isDirectory()) continue;
        for (const file of await readdir(path.join(root, shard.name), { withFileTypes: true })) {
          if (file.isFile() && file.name.endsWith('.json')) ids.push(file.name.slice(0, -5));
        }
      }
      for (const id of ids.sort()) {
        const item = await repository.get(id);
        if (item !== undefined) yield item;
      }
    },
  };
  return repository;
}

export function createLocalFilePlanFlowRepository(dataRoot: DataRoot): PlanFlowRepository {
  const paths = createStorePaths(dataRoot);
  const repository: PlanFlowRepository = {
    async get(id) {
      try {
        return decodeAggregateDocument(
          await readFile(paths.aggregate('plan-flows', id), 'utf8'),
          PlanFlowSchema,
        ).data as PlanFlow;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
      }
    },
    async save(tx, flow, expectedVersion) {
      const currentVersion = (await repository.get(flow.id))?.resourceVersion ?? 0;
      if (currentVersion !== expectedVersion || flow.resourceVersion !== expectedVersion) {
        throw new RepositoryVersionConflictError(currentVersion);
      }
      const data = { ...flow, resourceVersion: expectedVersion + 1 };
      const absolute = paths.aggregate('plan-flows', flow.id);
      await tx.stageJson(path.relative(dataRoot.absolutePath, absolute).replaceAll('\\', '/'), {
        schema: 'learning-more/plan-flow',
        schemaVersion: 1,
        entityType: 'plan-flows',
        entityId: flow.id,
        resourceVersion: expectedVersion + 1,
        createdAt: flow.createdAt,
        updatedAt: flow.updatedAt,
        contentSha256: checksumJson(data),
        data,
      });
    },
    async *list() {
      const root = path.join(dataRoot.absolutePath, 'entities', 'plan-flows');
      const ids: string[] = [];
      for (const shard of await readdir(root, { withFileTypes: true }).catch(() => [])) {
        if (!shard.isDirectory()) continue;
        for (const file of await readdir(path.join(root, shard.name), { withFileTypes: true })) {
          if (file.isFile() && file.name.endsWith('.json')) ids.push(file.name.slice(0, -5));
        }
      }
      for (const id of ids.sort()) {
        const flow = await repository.get(id);
        if (flow !== undefined) yield flow;
      }
    },
  };
  return repository;
}
