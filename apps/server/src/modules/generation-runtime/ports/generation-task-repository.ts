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
  readonly requestRef?: string | undefined;
  readonly inputSnapshotHash?: string | undefined;
  readonly priority?: number | undefined;
  readonly providerId?: string | undefined;
  readonly model?: string | undefined;
  readonly reasoningEffort?: string | undefined;
  readonly fallbackProviderIds?: readonly string[] | undefined;
  readonly maxAttempts?: number | undefined;
  readonly attempts?: readonly GenerationAttempt[] | undefined;
  readonly prompt?: string | undefined;
  readonly draftMarkdown?: string | undefined;
  readonly firstDeltaAt?: string | undefined;
  readonly resultRef?: string | undefined;
  readonly errorCode?: string | undefined;
  readonly leaseExpiresAt?: string | undefined;
  readonly compactedAt?: string | undefined;
}

export interface GenerationAttempt {
  readonly providerId: string;
  readonly model?: string | undefined;
  readonly startedAt: string;
  readonly completedAt?: string | undefined;
  readonly status: 'running' | 'completed' | 'failed';
  readonly errorCode?: string | undefined;
  readonly emittedDelta: boolean;
}

export interface GenerationTaskRepository {
  get(taskId: string): Promise<GenerationTask | undefined>;
  save(tx: TransactionContext, task: GenerationTask, expectedVersion: number): Promise<void>;
  list(): AsyncIterable<GenerationTask>;
}
