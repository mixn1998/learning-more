export type OutlineSessionEvent =
  | Readonly<{ type: 'AssessmentStarted' }>
  | Readonly<{ type: 'AssessmentCompleted'; assessmentArtifactId: string }>
  | Readonly<{ type: 'CandidateGenerationStarted'; generationTaskId: string }>
  | Readonly<{ type: 'CandidateVersionCreated'; candidateVersionId: string }>
  | Readonly<{ type: 'CandidateConfirmationStarted'; candidateVersionId: string }>
  | Readonly<{ type: 'CourseConfirmationCompleted'; courseId: string }>;
