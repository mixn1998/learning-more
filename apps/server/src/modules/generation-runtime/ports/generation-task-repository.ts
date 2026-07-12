import type { TransactionContext } from '../../../persistence/unit-of-work.js';

export interface GenerationTask {
  readonly id: string;
  readonly taskKey: string;
  readonly status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'timeout';
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly resourceVersion: number;
  readonly taskKind?: string | undefined;
  readonly taskGroup?: 'interactive' | 'background' | undefined;
  readonly ownerRef?: string | undefined;
  readonly inputSnapshotHash?: string | undefined;
  readonly priority?: number | undefined;
  readonly providerId?: string | undefined;
  readonly prompt?: string | undefined;
  readonly draftMarkdown?: string | undefined;
  readonly resultRef?: string | undefined;
  readonly errorCode?: string | undefined;
  readonly leaseExpiresAt?: string | undefined;
}

export interface GenerationTaskRepository {
  get(taskId: string): Promise<GenerationTask | undefined>;
  save(tx: TransactionContext, task: GenerationTask, expectedVersion: number): Promise<void>;
  list(): AsyncIterable<GenerationTask>;
}
