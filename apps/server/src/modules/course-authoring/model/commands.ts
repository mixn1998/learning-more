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
  | Readonly<{ type: 'skipAssessment'; assessmentArtifactId: string }>
  | Readonly<{ type: 'completeAssessment'; assessmentArtifactId: string }>
  | Readonly<{ type: 'requestCandidate'; generationTaskId: string }>
  | Readonly<{
      type: 'candidateGenerated';
      generationTaskId: string;
      candidateVersionId: string;
    }>
  | Readonly<{ type: 'confirmCandidate'; candidateVersionId: string }>
  | Readonly<{ type: 'completeConfirmation'; courseId: string }>;
