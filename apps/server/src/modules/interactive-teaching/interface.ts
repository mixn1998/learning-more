import type {
  CommandContext,
  TeachingCheckpointReason,
  TeachingCheckpointSnapshot,
  TeachingStateSnapshot,
} from '@learning-more/contracts';

export type AdvanceTeachingTurn = Readonly<{
  courseId: string;
  lessonId: string;
  sessionId: string;
  userMessageId: string;
  userContentArtifactRef: string;
}>;

export type OpenTeachingLesson = Readonly<{
  courseId: string;
  lessonId: string;
  sessionId: string;
}>;

export type TeachingTurnAccepted = Readonly<{
  taskId: string;
  resourceVersion: number;
}>;

export type StopTeachingTurn = Readonly<{
  sessionId: string;
  taskId: string;
}>;

export type TeachingTurnStopped = Readonly<{
  taskId: string;
  assistantMessageId: string;
  draftArtifactRef: string;
  completionStatus: 'interrupted';
  resourceVersion: number;
}>;

export type MaterializedTeachingMessage = Readonly<{
  messageId: string;
  role: 'user' | 'assistant';
  completionStatus: 'complete' | 'interrupted' | 'failed';
  markdown: string;
  sourceRef: string;
}>;

export interface InteractiveTeaching {
  advanceTurn(input: AdvanceTeachingTurn, context: CommandContext): Promise<TeachingTurnAccepted>;
  openLesson(input: OpenTeachingLesson, context: CommandContext): Promise<TeachingTurnAccepted>;
  stopTurn(input: StopTeachingTurn, context: CommandContext): Promise<TeachingTurnStopped>;
  getTeachingState(sessionId: string): Promise<TeachingStateSnapshot>;
  freezeCheckpoint(input: {
    sessionId: string;
    reason: TeachingCheckpointReason;
  }): Promise<TeachingCheckpointSnapshot>;
}
