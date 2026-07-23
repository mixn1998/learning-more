export type CourseAuthoringErrorCode =
  | 'assessment_required'
  | 'candidate_stale'
  | 'generation_in_progress'
  | 'confirmation_in_progress'
  | 'outline_session_transition_invalid';

export class CourseAuthoringError extends Error {
  constructor(readonly code: CourseAuthoringErrorCode) {
    super(code);
    this.name = 'CourseAuthoringError';
  }
}
