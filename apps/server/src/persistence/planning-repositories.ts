import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import type { ScheduleItem } from '../modules/planning/model/schedule-item.js';
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
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  processedCommandIds: z.array(z.string().min(1)),
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
