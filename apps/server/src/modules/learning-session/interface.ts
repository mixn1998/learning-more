import type { CommandContext, CommandResult, QueryContext } from '@learning-more/contracts';

import type { LessonLearning } from './model/learning-session.js';

type LessonCommand = Readonly<{ lessonId: string }>;

export type LearningSessionCommand =
  | (LessonCommand & Readonly<{ type: 'StartLesson' }>)
  | (LessonCommand & Readonly<{ type: 'PauseLesson' }>)
  | (LessonCommand & Readonly<{ type: 'ResumeLesson' }>)
  | (LessonCommand &
      Readonly<{
        type: 'AppendUserMessage';
        messageId: string;
        contentArtifactRef: string;
        establishesEvidence: boolean;
      }>)
  | (LessonCommand &
      Readonly<{
        type: 'CommitAssistantMessage';
        messageId: string;
        contentArtifactRef: string;
        generationTaskId: string;
        establishesEvidence?: boolean;
      }>)
  | (LessonCommand & Readonly<{ type: 'StartSessionGeneration'; taskId: string }>)
  | (LessonCommand & Readonly<{ type: 'StopSessionGeneration' }>)
  | (LessonCommand & Readonly<{ type: 'AbandonLesson' }>)
  | (LessonCommand & Readonly<{ type: 'RestoreLesson' }>)
  | (LessonCommand & Readonly<{ type: 'CommitFinalReview'; reviewId: string }>);

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
}>;

export interface LearningSessionModule {
  execute(
    command: LearningSessionCommand,
    context: CommandContext,
  ): Promise<CommandResult<LearningSessionResult>>;
  query(query: LearningSessionQuery, context: QueryContext): Promise<LearningSessionView>;
}
