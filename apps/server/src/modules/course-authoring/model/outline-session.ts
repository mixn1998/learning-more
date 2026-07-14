import type { CourseMode, OutlineSessionCommand } from './commands.js';
import { CourseAuthoringError } from './errors.js';
import type { OutlineSessionEvent } from './events.js';

export type OutlineSessionState =
  | 'collecting-input'
  | 'assessing'
  | 'assessment-turn-running'
  | 'assessment-ready'
  | 'alignment-turn-running'
  | 'generating-candidates'
  | 'candidate-ready'
  | 'confirming'
  | 'confirmed';

export interface OutlineSession {
  readonly outlineSessionId: string;
  readonly courseMode: CourseMode;
  readonly topic: string;
  readonly state: OutlineSessionState;
  readonly messageIds: readonly string[];
  readonly completedAssessmentRounds: number;
  readonly activeUserMessageId?: string;
  readonly pendingAlignment?: Readonly<{
    action: 'regenerate' | 'patch';
    targetModuleIds: readonly string[];
  }>;
  readonly activeCandidateTaskId?: string;
  readonly candidateVersionIds: readonly string[];
  readonly latestCandidateVersionId?: string;
  readonly confirmingCandidateVersionId?: string;
  readonly confirmedCourseId?: string;
  readonly savedAsDraft?: boolean;
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
    messageIds: [],
    completedAssessmentRounds: 0,
    candidateVersionIds: [],
  };
}

export function createOutlineAdjustmentSession(input: {
  readonly outlineSessionId: string;
  readonly courseMode: CourseMode;
  readonly topic: string;
  readonly baselineCandidateVersionId: string;
}): OutlineSession {
  return {
    outlineSessionId: input.outlineSessionId,
    courseMode: input.courseMode,
    topic: input.topic.trim(),
    state: 'candidate-ready',
    messageIds: [],
    completedAssessmentRounds: 3,
    candidateVersionIds: [input.baselineCandidateVersionId],
    latestCandidateVersionId: input.baselineCandidateVersionId,
  };
}

export function decide(
  session: OutlineSession,
  command: OutlineSessionCommand,
): readonly OutlineSessionEvent[] {
  if (command.type === 'startAssessment' && session.state === 'collecting-input') {
    return [{ type: 'AssessmentStarted' }];
  }
  if (
    command.type === 'startAssessmentTurn' &&
    (session.state === 'assessing' || session.state === 'assessment-ready')
  ) {
    return [{ type: 'AssessmentTurnStarted', userMessageId: command.userMessageId }];
  }
  if (command.type === 'startAlignmentTurn' && session.state === 'candidate-ready') {
    return [{ type: 'AlignmentTurnStarted', userMessageId: command.userMessageId }];
  }
  if (
    command.type === 'completeAlignmentTurn' &&
    session.state === 'alignment-turn-running' &&
    session.activeUserMessageId === command.userMessageId
  ) {
    return [
      {
        type: 'AlignmentTurnCompleted',
        userMessageId: command.userMessageId,
        assistantMessageId: command.assistantMessageId,
        action: command.action,
        targetModuleIds: command.targetModuleIds,
      },
    ];
  }
  if (
    command.type === 'failAlignmentTurn' &&
    session.state === 'alignment-turn-running' &&
    session.activeUserMessageId === command.userMessageId
  ) {
    return [{ type: 'AlignmentTurnFailed', userMessageId: command.userMessageId }];
  }
  if (
    command.type === 'completeAssessmentTurn' &&
    session.state === 'assessment-turn-running' &&
    session.activeUserMessageId === command.userMessageId
  ) {
    return [
      {
        type: 'AssessmentTurnCompleted',
        userMessageId: command.userMessageId,
        assistantMessageId: command.assistantMessageId,
      },
    ];
  }
  if (
    command.type === 'failAssessmentTurn' &&
    session.state === 'assessment-turn-running' &&
    session.activeUserMessageId === command.userMessageId
  ) {
    return [{ type: 'AssessmentTurnFailed', userMessageId: command.userMessageId }];
  }
  if (command.type === 'requestCandidate') {
    if (
      session.state === 'collecting-input' ||
      session.state === 'assessing' ||
      session.state === 'assessment-turn-running'
    ) {
      throw new CourseAuthoringError('assessment_required');
    }
    if (session.state === 'assessment-ready' || session.state === 'candidate-ready') {
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
  if (command.type === 'candidateGenerationFailed') {
    if (
      session.state !== 'generating-candidates' ||
      session.activeCandidateTaskId !== command.generationTaskId
    ) {
      throw new CourseAuthoringError('candidate_stale');
    }
    return [{ type: 'CandidateGenerationFailed', generationTaskId: command.generationTaskId }];
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
  if (event.type === 'AssessmentTurnStarted') {
    return {
      ...session,
      state: 'assessment-turn-running',
      activeUserMessageId: event.userMessageId,
      messageIds: [...session.messageIds, event.userMessageId],
    };
  }
  if (event.type === 'AssessmentTurnCompleted') {
    const completedAssessmentRounds = session.completedAssessmentRounds + 1;
    const { activeUserMessageId: _completedUserMessage, ...withoutActiveTurn } = session;
    void _completedUserMessage;
    return {
      ...withoutActiveTurn,
      state: completedAssessmentRounds >= 3 ? 'assessment-ready' : 'assessing',
      completedAssessmentRounds,
      messageIds: [...session.messageIds, event.assistantMessageId],
    };
  }
  if (event.type === 'AssessmentTurnFailed') {
    const { activeUserMessageId: _failedUserMessage, ...withoutActiveTurn } = session;
    void _failedUserMessage;
    return {
      ...withoutActiveTurn,
      state: session.completedAssessmentRounds >= 3 ? 'assessment-ready' : 'assessing',
    };
  }
  if (event.type === 'AlignmentTurnStarted') {
    return {
      ...session,
      state: 'alignment-turn-running',
      activeUserMessageId: event.userMessageId,
      messageIds: [...session.messageIds, event.userMessageId],
    };
  }
  if (event.type === 'AlignmentTurnCompleted') {
    const {
      activeUserMessageId: _completedUserMessage,
      pendingAlignment: _completedAlignment,
      ...withoutActiveTurn
    } = session;
    void _completedUserMessage;
    void _completedAlignment;
    return {
      ...withoutActiveTurn,
      state: 'candidate-ready',
      messageIds: [...session.messageIds, event.assistantMessageId],
      ...(event.action === 'clarify'
        ? {}
        : {
            pendingAlignment: {
              action: event.action,
              targetModuleIds: event.targetModuleIds,
            },
          }),
    };
  }
  if (event.type === 'AlignmentTurnFailed') {
    const { activeUserMessageId: _failedUserMessage, ...withoutActiveTurn } = session;
    void _failedUserMessage;
    return { ...withoutActiveTurn, state: 'candidate-ready' };
  }
  if (event.type === 'CandidateGenerationStarted') {
    return {
      ...session,
      state: 'generating-candidates',
      activeCandidateTaskId: event.generationTaskId,
    };
  }
  if (event.type === 'CandidateVersionCreated') {
    const {
      activeCandidateTaskId: _completedTask,
      pendingAlignment: _completedAlignment,
      ...withoutActiveTask
    } = session;
    void _completedTask;
    void _completedAlignment;
    return {
      ...withoutActiveTask,
      state: 'candidate-ready',
      latestCandidateVersionId: event.candidateVersionId,
      candidateVersionIds: [...session.candidateVersionIds, event.candidateVersionId],
    };
  }
  if (event.type === 'CandidateGenerationFailed') {
    const { activeCandidateTaskId: _failedTask, ...withoutActiveTask } = session;
    void _failedTask;
    return {
      ...withoutActiveTask,
      state:
        session.latestCandidateVersionId === undefined ? 'assessment-ready' : 'candidate-ready',
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
  return session;
}

export function evolveAll(
  session: OutlineSession,
  events: readonly OutlineSessionEvent[],
): OutlineSession {
  return events.reduce(evolve, session);
}
