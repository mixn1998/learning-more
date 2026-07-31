import type { GenerationStreamEvent, GenerationStreamEventType } from '@learning-more/contracts';

import type { GenerationTask } from './ports/generation-task-repository.js';

export interface GenerationRequest {
  readonly taskKey: string;
  readonly inputSnapshotHash: string;
  readonly taskKind: string;
  readonly taskGroup: 'interactive' | 'background';
  readonly ownerRef: string;
  readonly requestRef?: string;
  readonly providerId: string;
  readonly model?: string;
  readonly reasoningEffort?: string;
  readonly fallbackProviderIds?: readonly string[];
  readonly maxAttempts?: number;
  readonly priority: number;
  readonly prompt: string;
}

export interface GenerationTaskHandle {
  readonly taskId: string;
}

export interface GenerationRuntime {
  submit(request: GenerationRequest): Promise<GenerationTaskHandle>;
  runNext(): Promise<string | undefined>;
  cancel(taskId: string): Promise<GenerationTask>;
  invalidate?(taskId: string, errorCode: string): Promise<GenerationTask>;
  get(taskId: string): Promise<GenerationTask>;
  listByOwner(ownerRef: string, taskKind?: string): Promise<readonly GenerationTask[]>;
  recoverExpiredLeases(): Promise<number>;
  getMetrics(): Promise<GenerationRuntimeMetrics>;
  subscribe?(taskId: string, observer: (task: GenerationTask) => void): () => void;
}

export type GenerationRuntimeMetrics = Readonly<{
  total: number;
  byStatus: Readonly<Record<string, number>>;
  byErrorCode: Readonly<Record<string, number>>;
}>;

export interface GenerationFrameMeta {
  readonly taskId: string;
  state: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'timeout';
  lastSequence: number;
}

export interface GenerationFrameLog {
  ensureTask(taskId: string, state: GenerationFrameMeta['state']): Promise<void>;
  append(
    taskId: string,
    type: GenerationStreamEventType,
    data: unknown,
  ): Promise<GenerationStreamEvent>;
  readAfter(
    taskId: string,
    sequence: number,
  ): Promise<{
    reset: boolean;
    frames: GenerationStreamEvent[];
    meta: GenerationFrameMeta;
  }>;
  compactTerminal(
    taskId: string,
    state: Extract<GenerationFrameMeta['state'], 'completed' | 'failed' | 'cancelled' | 'timeout'>,
  ): Promise<void>;
}

export interface GenerationExecution {
  submit(request: GenerationRequest): Promise<{ taskId: string }>;
  awaitTerminal(taskId: string): Promise<GenerationTask>;
  stream(taskId: string, afterSequence: number): ReturnType<GenerationFrameLog['readAfter']>;
  cancel(taskId: string): Promise<GenerationTask>;
  invalidate?(taskId: string, errorCode: string): Promise<GenerationTask>;
  recover(taskId: string): Promise<GenerationTask>;
  subscribe?(taskId: string, observer: (task: GenerationTask) => void): () => void;
}
