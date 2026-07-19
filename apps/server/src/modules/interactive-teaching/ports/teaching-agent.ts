import type { GenerationRuntime } from '../../generation-runtime/interface.js';
import type { TeachingContextPackage } from './teaching-context-sources.js';

type TeachingGenerationTask = Awaited<
  ReturnType<Pick<GenerationRuntime, 'listByOwner'>['listByOwner']>
>[number];

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
    depthPreference?: 'default' | 'condensed';
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

export type TeachingAgentCompletionObserver = Readonly<{
  onDirective?(directive: TeachingDirective): void | Promise<void>;
  onReplyDelta?(markdown: string): void | Promise<void>;
}>;

export interface TeachingAgent {
  submit(context: TeachingContextPackage, requestRef: string): Promise<{ taskId: string }>;
  listTasks(sessionId: string): Promise<readonly TeachingGenerationTask[]>;
  cancel(taskId: string): Promise<void>;
  complete(
    taskId: string,
    observer?: TeachingAgentCompletionObserver,
    signal?: AbortSignal,
  ): Promise<TeachingAgentResult>;
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
