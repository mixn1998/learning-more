import type { TeachingContextPackage } from './teaching-context-sources.js';

export interface TeachingAgent {
  submit(context: TeachingContextPackage): Promise<{ taskId: string }>;
  complete(taskId: string, signal?: AbortSignal): Promise<{ markdown: string }>;
  recover(
    taskId: string,
  ): Promise<
    | { markdown: string; completionStatus: 'complete' | 'interrupted' }
    | { completionStatus: 'failed'; errorCode: string }
  >;
  stop(taskId: string): Promise<{
    markdown: string;
    completionStatus: 'interrupted';
  }>;
}
