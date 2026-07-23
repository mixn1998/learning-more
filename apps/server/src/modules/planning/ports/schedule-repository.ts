import type { TransactionContext } from '../../../persistence/unit-of-work.js';
import { RepositoryVersionConflictError } from '../../../persistence/repository-errors.js';
import type { ScheduleItem } from '../model/schedule-item.js';

export interface ScheduleRepository {
  get(id: string): Promise<ScheduleItem | undefined>;
  save(tx: TransactionContext, item: ScheduleItem, expectedVersion: number): Promise<void>;
  list(): AsyncIterable<ScheduleItem>;
}

export function createInMemoryScheduleRepository(): ScheduleRepository {
  const items = new Map<string, ScheduleItem>();
  return {
    get: async (id) => structuredClone(items.get(id)),
    async save(_tx, item, expectedVersion) {
      const currentVersion = items.get(item.id)?.resourceVersion ?? 0;
      if (currentVersion !== expectedVersion || item.resourceVersion !== expectedVersion) {
        throw new RepositoryVersionConflictError(currentVersion);
      }
      items.set(item.id, structuredClone({ ...item, resourceVersion: expectedVersion + 1 }));
    },
    async *list() {
      for (const id of [...items.keys()].sort()) yield structuredClone(items.get(id)!);
    },
  };
}
