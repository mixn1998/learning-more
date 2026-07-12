import type { TransactionContext } from '../../../persistence/unit-of-work.js';

export interface GenerationTask {
  readonly id: string;
  readonly taskKey: string;
  readonly status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'timeout';
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly resourceVersion: number;
}

export interface GenerationTaskRepository {
  get(taskId: string): Promise<GenerationTask | undefined>;
  save(tx: TransactionContext, task: GenerationTask, expectedVersion: number): Promise<void>;
  list(): AsyncIterable<GenerationTask>;
}
