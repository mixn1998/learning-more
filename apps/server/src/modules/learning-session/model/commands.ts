export type LearningSessionCommand =
  | Readonly<{ type: 'start'; sessionId: string }>
  | Readonly<{ type: 'pause' }>
  | Readonly<{ type: 'resume' }>
  | Readonly<{
      type: 'appendUserMessage';
      messageId: string;
      establishesEvidence: boolean;
    }>
  | Readonly<{
      type: 'commitAssistantMessage';
      messageId: string;
      establishesEvidence: boolean;
    }>
  | Readonly<{ type: 'startGeneration'; taskId: string }>
  | Readonly<{ type: 'stopGeneration' }>
  | Readonly<{ type: 'abandon' }>
  | Readonly<{ type: 'restore' }>
  | Readonly<{ type: 'commitFinalReview'; reviewId: string }>;
