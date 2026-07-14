export type OutlineSessionEvent =
  | Readonly<{ type: 'AssessmentStarted' }>
  | Readonly<{ type: 'AssessmentTurnStarted'; userMessageId: string }>
  | Readonly<{
      type: 'AssessmentTurnCompleted';
      userMessageId: string;
      assistantMessageId: string;
    }>
  | Readonly<{ type: 'AssessmentTurnFailed'; userMessageId: string }>
  | Readonly<{ type: 'AlignmentTurnStarted'; userMessageId: string }>
  | Readonly<{
      type: 'AlignmentTurnCompleted';
      userMessageId: string;
      assistantMessageId: string;
      action: 'clarify' | 'regenerate' | 'patch';
      targetModuleIds: readonly string[];
    }>
  | Readonly<{ type: 'AlignmentTurnFailed'; userMessageId: string }>
  | Readonly<{ type: 'CandidateGenerationStarted'; generationTaskId: string }>
  | Readonly<{ type: 'CandidateVersionCreated'; candidateVersionId: string }>
  | Readonly<{ type: 'CandidateGenerationFailed'; generationTaskId: string }>
  | Readonly<{ type: 'CandidateConfirmationStarted'; candidateVersionId: string }>
  | Readonly<{ type: 'CourseConfirmationCompleted'; courseId: string }>;
