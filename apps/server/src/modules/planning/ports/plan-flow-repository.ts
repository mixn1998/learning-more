import { RepositoryVersionConflictError } from '../../../persistence/repository-errors.js';
import type { TransactionContext } from '../../../persistence/unit-of-work.js';
import type { PlanFlow } from '../model/plan-flow.js';

export interface PlanFlowRepository {
  get(id: string): Promise<PlanFlow | undefined>;
  save(tx: TransactionContext, flow: PlanFlow, expectedVersion: number): Promise<void>;
  list(): AsyncIterable<PlanFlow>;
}

export function createInMemoryPlanFlowRepository(): PlanFlowRepository {
  const flows = new Map<string, PlanFlow>();
  return {
    get: async (id) => structuredClone(flows.get(id)),
    async save(_tx, flow, expectedVersion) {
      const currentVersion = flows.get(flow.id)?.resourceVersion ?? 0;
      if (currentVersion !== expectedVersion || flow.resourceVersion !== expectedVersion) {
        throw new RepositoryVersionConflictError(currentVersion);
      }
      flows.set(flow.id, structuredClone({ ...flow, resourceVersion: expectedVersion + 1 }));
    },
    async *list() {
      for (const id of [...flows.keys()].sort()) yield structuredClone(flows.get(id)!);
    },
  };
}
