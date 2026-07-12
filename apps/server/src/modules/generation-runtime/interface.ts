import type { GenerationTask } from './ports/generation-task-repository.js';

export interface GenerationRequest {
  readonly taskKey: string;
  readonly inputSnapshotHash: string;
  readonly taskKind: string;
  readonly taskGroup: 'interactive' | 'background';
  readonly ownerRef: string;
  readonly providerId: string;
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
  get(taskId: string): Promise<GenerationTask>;
  recoverExpiredLeases(): Promise<number>;
}
