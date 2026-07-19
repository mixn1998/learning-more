export type LearningSessionCommand =
  | Readonly<{ type: 'start'; sessionId: string }>
  | Readonly<{ type: 'pause' }>
  | Readonly<{ type: 'resume' }>
  | Readonly<{
      type: 'appendUserMessage';
      messageId: string;
    }>
  | Readonly<{
      type: 'replacePendingUserTurn';
      replacedMessageIds: readonly string[];
      messageId: string;
    }>
  | Readonly<{
      type: 'commitAssistantMessage';
      sessionId: string;
      generationTaskId: string;
      messageId: string;
    }>
  | Readonly<{ type: 'establishEvidenceCheckpoint' }>
  | Readonly<{
      type: 'startGeneration';
      taskId: string;
      mode: 'new-turn' | 'retry' | 'recovery';
    }>
  | Readonly<{ type: 'stopGeneration' }>
  | Readonly<{ type: 'abandon' }>
  | Readonly<{ type: 'restore' }>
  | Readonly<{ type: 'commitStageReview'; reviewId: string }>
  | Readonly<{ type: 'completePendingReview' }>
  | Readonly<{ type: 'commitFinalReview'; reviewId: string }>;
