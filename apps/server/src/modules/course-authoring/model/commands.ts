export type CourseMode =
  | 'standard'
  | 'brainstorm'
  | 'argument_clash'
  | 'case_study'
  | 'business_insight'
  | 'process_decomposition'
  | 'decision_analysis'
  | 'cross_explore'
  | 'reading_seminar';

export type OutlineSessionCommand =
  | Readonly<{ type: 'startAssessment' }>
  | Readonly<{ type: 'startAssessmentTurn'; userMessageId: string }>
  | Readonly<{
      type: 'completeAssessmentTurn';
      userMessageId: string;
      assistantMessageId: string;
    }>
  | Readonly<{ type: 'failAssessmentTurn'; userMessageId: string }>
  | Readonly<{ type: 'startAlignmentTurn'; userMessageId: string }>
  | Readonly<{
      type: 'completeAlignmentTurn';
      userMessageId: string;
      assistantMessageId: string;
      action: 'clarify' | 'regenerate' | 'patch';
      targetModuleIds: readonly string[];
    }>
  | Readonly<{ type: 'failAlignmentTurn'; userMessageId: string }>
  | Readonly<{ type: 'requestCandidate'; generationTaskId: string }>
  | Readonly<{
      type: 'candidateGenerated';
      generationTaskId: string;
      candidateVersionId: string;
    }>
  | Readonly<{ type: 'candidateGenerationFailed'; generationTaskId: string }>
  | Readonly<{ type: 'confirmCandidate'; candidateVersionId: string }>
  | Readonly<{ type: 'completeConfirmation'; courseId: string }>;
