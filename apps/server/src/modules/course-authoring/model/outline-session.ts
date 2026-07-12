import type { CourseMode, OutlineSessionCommand } from './commands.js';
import { CourseAuthoringError } from './errors.js';
import type { OutlineSessionEvent } from './events.js';

export type OutlineSessionState =
  | 'collecting-input'
  | 'assessing'
  | 'ready-for-candidates'
  | 'generating-candidates'
  | 'candidate-ready'
  | 'confirming'
  | 'confirmed';

export interface OutlineSession {
  readonly outlineSessionId: string;
  readonly courseMode: CourseMode;
  readonly topic: string;
  readonly state: OutlineSessionState;
  readonly assessmentArtifactId?: string;
  readonly activeCandidateTaskId?: string;
  readonly candidateVersionIds: readonly string[];
  readonly latestCandidateVersionId?: string;
  readonly confirmingCandidateVersionId?: string;
  readonly confirmedCourseId?: string;
}

export function createOutlineSession(input: {
  readonly outlineSessionId: string;
  readonly courseMode: CourseMode;
  readonly topic: string;
}): OutlineSession {
  return {
    ...input,
    topic: input.topic.trim(),
    state: 'collecting-input',
    candidateVersionIds: [],
  };
}

export function decide(
  session: OutlineSession,
  command: OutlineSessionCommand,
): readonly OutlineSessionEvent[] {
  if (command.type === 'startAssessment' && session.state === 'collecting-input') {
    return [{ type: 'AssessmentStarted' }];
  }
  if (command.type === 'completeAssessment' && session.state === 'assessing') {
    return [{ type: 'AssessmentCompleted', assessmentArtifactId: command.assessmentArtifactId }];
  }
  if (
    command.type === 'skipAssessment' &&
    (session.state === 'collecting-input' || session.state === 'assessing')
  ) {
    return [{ type: 'AssessmentCompleted', assessmentArtifactId: command.assessmentArtifactId }];
  }
  if (command.type === 'requestCandidate') {
    if (session.state === 'collecting-input' || session.state === 'assessing') {
      throw new CourseAuthoringError('assessment_required');
    }
    if (session.state === 'ready-for-candidates' || session.state === 'candidate-ready') {
      return [{ type: 'CandidateGenerationStarted', generationTaskId: command.generationTaskId }];
    }
    if (session.state === 'generating-candidates') {
      throw new CourseAuthoringError('generation_in_progress');
    }
    if (session.state === 'confirming' || session.state === 'confirmed') {
      throw new CourseAuthoringError('confirmation_in_progress');
    }
  }
  if (command.type === 'candidateGenerated') {
    if (
      session.state !== 'generating-candidates' ||
      session.activeCandidateTaskId !== command.generationTaskId
    ) {
      throw new CourseAuthoringError('candidate_stale');
    }
    return [{ type: 'CandidateVersionCreated', candidateVersionId: command.candidateVersionId }];
  }
  if (command.type === 'confirmCandidate') {
    if (session.state === 'confirming' || session.state === 'confirmed') {
      throw new CourseAuthoringError('confirmation_in_progress');
    }
    if (
      session.state !== 'candidate-ready' ||
      session.latestCandidateVersionId !== command.candidateVersionId
    ) {
      throw new CourseAuthoringError('candidate_stale');
    }
    return [
      { type: 'CandidateConfirmationStarted', candidateVersionId: command.candidateVersionId },
    ];
  }
  if (command.type === 'completeConfirmation' && session.state === 'confirming') {
    return [{ type: 'CourseConfirmationCompleted', courseId: command.courseId }];
  }
  throw new CourseAuthoringError('outline_session_transition_invalid');
}

export function evolve(session: OutlineSession, event: OutlineSessionEvent): OutlineSession {
  if (event.type === 'AssessmentStarted') return { ...session, state: 'assessing' };
  if (event.type === 'CandidateGenerationStarted') {
    return {
      ...session,
      state: 'generating-candidates',
      activeCandidateTaskId: event.generationTaskId,
    };
  }
  if (event.type === 'CandidateVersionCreated') {
    const { activeCandidateTaskId: _completedTask, ...withoutActiveTask } = session;
    void _completedTask;
    return {
      ...withoutActiveTask,
      state: 'candidate-ready',
      latestCandidateVersionId: event.candidateVersionId,
      candidateVersionIds: [...session.candidateVersionIds, event.candidateVersionId],
    };
  }
  if (event.type === 'CandidateConfirmationStarted') {
    return {
      ...session,
      state: 'confirming',
      confirmingCandidateVersionId: event.candidateVersionId,
    };
  }
  if (event.type === 'CourseConfirmationCompleted') {
    return { ...session, state: 'confirmed', confirmedCourseId: event.courseId };
  }
  return {
    ...session,
    state: 'ready-for-candidates',
    assessmentArtifactId: event.assessmentArtifactId,
  };
}

export function evolveAll(
  session: OutlineSession,
  events: readonly OutlineSessionEvent[],
): OutlineSession {
  return events.reduce(evolve, session);
}
