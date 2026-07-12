type EventBase = Readonly<{ commandId: string }>;

export type LearningSessionEvent =
  | (EventBase & Readonly<{ type: 'OriginalSessionStarted'; sessionId: string }>)
  | (EventBase & Readonly<{ type: 'OriginalSessionPaused' }>)
  | (EventBase & Readonly<{ type: 'OriginalSessionResumed' }>)
  | (EventBase &
      Readonly<{
        type: 'UserMessageAppended';
        messageId: string;
        establishesEvidence: boolean;
      }>)
  | (EventBase &
      Readonly<{
        type: 'AssistantMessageCommitted';
        messageId: string;
        establishesEvidence: boolean;
      }>)
  | (EventBase & Readonly<{ type: 'GenerationStarted'; taskId: string }>)
  | (EventBase & Readonly<{ type: 'GenerationStopped' }>)
  | (EventBase & Readonly<{ type: 'EvidencedLessonAbandoned' }>)
  | (EventBase & Readonly<{ type: 'EvidenceFreeLessonAbandoned' }>)
  | (EventBase & Readonly<{ type: 'AbandonedLessonRestored' }>)
  | (EventBase & Readonly<{ type: 'StageReviewCommitted'; reviewId: string }>)
  | (EventBase & Readonly<{ type: 'FinalReviewCommitted'; reviewId: string }>);
