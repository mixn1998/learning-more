import type { TeachingContextPackage } from './teaching-context-sources.js';

export type TeachingDirective = Readonly<{
  schemaVersion: 1;
  lessonPhase:
    | 'warmup'
    | 'knowledge_point'
    | 'comprehensive_check'
    | 'discussion'
    | 'summary'
    | 'ready_to_close';
  activeKnowledgePointRef?: string | undefined;
  knowledgePoints: readonly Readonly<{
    ref: string;
    status: 'pending' | 'learning' | 'completed' | 'skipped';
    interactionStatus: 'pending' | 'completed' | 'skipped';
  }>[];
  difficultySignals?: readonly Readonly<{
    knowledgePointRef: string;
    sourceMessageId: string;
    kind: 'answer_error' | 'misunderstanding' | 'not_understood' | 'request_deeper_explanation';
  }>[];
  comprehensiveCheck: 'pending' | 'learning' | 'completed' | 'skipped';
  closureInquiry: 'pending' | 'awaiting_confirmation' | 'confirmed_no_questions';
  summaryStatus: 'pending' | 'delivered';
}>;

export type TeachingAgentResult = Readonly<{
  markdown: string;
  directive?: TeachingDirective | undefined;
}>;

export interface TeachingAgent {
  submit(context: TeachingContextPackage): Promise<{ taskId: string }>;
  complete(taskId: string, signal?: AbortSignal): Promise<TeachingAgentResult>;
  read(taskId: string): Promise<TeachingAgentResult | undefined>;
  recover(
    taskId: string,
  ): Promise<
    | (TeachingAgentResult & { completionStatus: 'complete' | 'interrupted' })
    | { completionStatus: 'failed'; errorCode: string }
  >;
  stop(taskId: string): Promise<{
    markdown: string;
    completionStatus: 'interrupted';
  }>;
}
