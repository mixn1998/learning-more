import type { GenerationRuntime } from '../../generation-runtime/interface.js';
import type { TeachingContextPackage } from './teaching-context-sources.js';

type TeachingGenerationTask = Awaited<
  ReturnType<Pick<GenerationRuntime, 'listByOwner'>['listByOwner']>
>[number];

type TeachingLessonPhase =
  | 'warmup'
  | 'knowledge_point'
  | 'comprehensive_check'
  | 'discussion'
  | 'summary'
  | 'ready_to_close';

type TeachingKnowledgePointStatus = 'pending' | 'learning' | 'completed' | 'skipped';
type TeachingInteractionStatus = 'pending' | 'completed' | 'skipped';
type TeachingDepthPreference = 'default' | 'condensed';
type TeachingComprehensiveStatus = 'pending' | 'learning' | 'completed' | 'skipped';
type TeachingClosureInquiry = 'pending' | 'awaiting_confirmation' | 'confirmed_no_questions';
type TeachingSummaryStatus = 'pending' | 'delivered';

type TeachingDifficultySignal = Readonly<{
  knowledgePointRef: string;
  sourceMessageId: string;
  kind: 'answer_error' | 'misunderstanding' | 'not_understood' | 'request_deeper_explanation';
}>;

export type FullTeachingDirective = Readonly<{
  schemaVersion: 1;
  lessonPhase: TeachingLessonPhase;
  activeKnowledgePointRef?: string | undefined;
  knowledgePoints: readonly Readonly<{
    ref: string;
    status: TeachingKnowledgePointStatus;
    interactionStatus: TeachingInteractionStatus;
    depthPreference?: TeachingDepthPreference;
  }>[];
  difficultySignals?: readonly TeachingDifficultySignal[];
  comprehensiveCheck: TeachingComprehensiveStatus;
  closureInquiry: TeachingClosureInquiry;
  summaryStatus: TeachingSummaryStatus;
}>;

export type SparseTeachingDirective = Readonly<{
  schemaVersion: 2;
  lessonPhase?: TeachingLessonPhase;
  activeKnowledgePointRef?: string | null;
  knowledgePoints?: readonly Readonly<{
    ref: string;
    status?: TeachingKnowledgePointStatus;
    interactionStatus?: TeachingInteractionStatus;
    depthPreference?: TeachingDepthPreference;
  }>[];
  difficultySignals?: readonly TeachingDifficultySignal[];
  comprehensiveCheck?: TeachingComprehensiveStatus;
  closureInquiry?: TeachingClosureInquiry;
  summaryStatus?: TeachingSummaryStatus;
}>;

export type TeachingDirective = FullTeachingDirective | SparseTeachingDirective;

export type TeachingAgentResult = Readonly<{
  markdown: string;
  directive?: TeachingDirective | undefined;
}>;

export type TeachingAgentCompletionObserver = Readonly<{
  onDirective?(directive: TeachingDirective): void | Promise<void>;
  onReplyDelta?(markdown: string): void | Promise<void>;
  onReplyCompleted?(markdown: string): void | Promise<void>;
}>;

export interface TeachingAgent {
  submit(context: TeachingContextPackage, requestRef: string): Promise<{ taskId: string }>;
  listTasks(sessionId: string): Promise<readonly TeachingGenerationTask[]>;
  cancel(taskId: string): Promise<void>;
  invalidate(taskId: string, errorCode: string): Promise<void>;
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
