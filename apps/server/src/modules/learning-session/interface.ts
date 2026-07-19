import type {
  CommandContext,
  CommandResult,
  QueryContext,
  ReviewDocument,
} from '@learning-more/contracts';

import type { LessonLearning } from './model/learning-session.js';

type LessonCommand = Readonly<{ lessonId: string }>;

export type LearningSessionCommand =
  | (LessonCommand & Readonly<{ type: 'StartLesson' }>)
  | (LessonCommand & Readonly<{ type: 'PauseLesson' }>)
  | (LessonCommand & Readonly<{ type: 'ResumeLesson' }>)
  | (LessonCommand & Readonly<{ type: 'TransferSessionLease' }>)
  | (LessonCommand &
      Readonly<{
        type: 'AppendUserMessage';
        messageId: string;
        contentArtifactRef: string;
      }>)
  | (LessonCommand &
      Readonly<{
        type: 'ReplacePendingUserTurn';
        replacedMessageIds: readonly string[];
        messageId: string;
        contentArtifactRef: string;
      }>)
  | (LessonCommand &
      Readonly<{
        type: 'CommitAssistantMessage';
        sessionId: string;
        messageId: string;
        contentArtifactRef: string;
        generationTaskId: string;
        completionStatus?: 'complete' | 'interrupted';
      }>)
  | (LessonCommand & Readonly<{ type: 'EstablishEvidenceCheckpoint' }>)
  | (LessonCommand &
      Readonly<{
        type: 'StartSessionGeneration';
        taskId: string;
        mode: 'new-turn' | 'retry' | 'recovery';
      }>)
  | (LessonCommand & Readonly<{ type: 'StopSessionGeneration' }>)
  | (LessonCommand & Readonly<{ type: 'AbandonLesson' }>)
  | (LessonCommand & Readonly<{ type: 'RestoreLesson' }>)
  | (LessonCommand & Readonly<{ type: 'CommitStageReview'; reviewId: string }>)
  | (LessonCommand & Readonly<{ type: 'CompleteLessonPendingReview' }>)
  | (LessonCommand &
      Readonly<{
        type: 'CommitFinalReview';
        reviewId: string;
        artifactRef: string;
        contentSha256: string;
        sourceSessionIds: readonly string[];
        messageRangeChecksum: string;
        document?: ReviewDocument;
      }>);

export type LearningSessionQuery = Readonly<{
  type: 'GetLessonLearning';
  lessonId: string;
}>;

export type LearningSessionResult = Readonly<{
  lessonId: string;
  progress: LessonLearning['progress'];
  sessionId?: string;
  resourceVersion: number;
  writable: boolean;
  leaseToken?: string;
}>;

export type LearningSessionView = Readonly<{
  learning: LessonLearning;
  resourceVersion: number;
  actualSeconds: number;
  finalReview?: Readonly<{
    id: string;
    artifactRef: string;
    contentSha256: string;
    sourceSessionIds: readonly string[];
    messageRangeChecksum: string;
    committedAt: string;
    document?: ReviewDocument;
  }>;
}>;

export interface LearningSessionModule {
  execute(
    command: LearningSessionCommand,
    context: CommandContext,
  ): Promise<CommandResult<LearningSessionResult>>;
  query(query: LearningSessionQuery, context: QueryContext): Promise<LearningSessionView>;
}
