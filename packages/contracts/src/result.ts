export type GenerationTaskReference = Readonly<{
  taskId: string;
}>;

export type CommandResult<T> = Readonly<{
  commandId: string;
  outcome: 'completed' | 'accepted';
  value: T;
  resourceVersion?: number;
  task?: GenerationTaskReference;
  projectionCursor?: string;
}>;
