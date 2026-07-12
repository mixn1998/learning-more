import type { LearningSessionCommand } from './commands.js';
import type { LearningSessionEvent } from './events.js';
import type { LessonProgressState } from './lesson-progress.js';

export type OriginalSessionState = 'active' | 'paused' | 'frozen' | 'closed';

export type OriginalLearningSession = Readonly<{
  id: string;
  state: OriginalSessionState;
  messageIds: readonly string[];
  evidenceCheckpoint: boolean;
  activeGenerationTaskId?: string;
  stageReviewId?: string;
  finalReviewId?: string;
}>;

export type LessonLearning = Readonly<{
  lessonId: string;
  progress: LessonProgressState;
  session?: OriginalLearningSession;
  processedCommandIds: readonly string[];
}>;

export type LearningSessionErrorCode =
  | 'lesson_not_startable'
  | 'lesson_not_restorable'
  | 'lesson_not_completable'
  | 'session_not_writable'
  | 'session_conflict'
  | 'generation_in_progress';

export class LearningSessionError extends Error {
  constructor(readonly code: LearningSessionErrorCode) {
    super(code);
    this.name = 'LearningSessionError';
  }
}

export function createLessonLearning(lessonId: string): LessonLearning {
  return { lessonId, progress: 'not_started', processedCommandIds: [] };
}

function event<T extends Omit<LearningSessionEvent, 'commandId'>>(
  commandId: string,
  value: T,
): LearningSessionEvent {
  return { commandId, ...value } as LearningSessionEvent;
}

export function decide(
  learning: LessonLearning,
  command: LearningSessionCommand,
  commandId: string,
): readonly LearningSessionEvent[] {
  if (learning.processedCommandIds.includes(commandId)) return [];
  if (learning.progress === 'completed') {
    throw new LearningSessionError('lesson_not_startable');
  }

  if (command.type === 'start') {
    if (learning.progress !== 'not_started' || learning.session !== undefined) {
      throw new LearningSessionError('session_conflict');
    }
    return [event(commandId, { type: 'OriginalSessionStarted', sessionId: command.sessionId })];
  }

  if (command.type === 'restore') {
    if (
      learning.progress !== 'abandoned' ||
      learning.session === undefined ||
      learning.session.state !== 'frozen'
    ) {
      throw new LearningSessionError('lesson_not_restorable');
    }
    return [event(commandId, { type: 'AbandonedLessonRestored' })];
  }

  if (command.type === 'commitStageReview') {
    if (learning.session === undefined || learning.session.state === 'closed') {
      throw new LearningSessionError('session_not_writable');
    }
    return [event(commandId, { type: 'StageReviewCommitted', reviewId: command.reviewId })];
  }

  const session = learning.session;
  if (learning.progress !== 'in_progress' || session === undefined) {
    throw new LearningSessionError('session_not_writable');
  }

  if (command.type === 'pause') {
    if (session.state !== 'active') throw new LearningSessionError('session_not_writable');
    return [event(commandId, { type: 'OriginalSessionPaused' })];
  }
  if (command.type === 'resume') {
    if (session.state !== 'paused') throw new LearningSessionError('session_not_writable');
    return [event(commandId, { type: 'OriginalSessionResumed' })];
  }
  if (command.type === 'appendUserMessage' || command.type === 'commitAssistantMessage') {
    if (session.state !== 'active') throw new LearningSessionError('session_not_writable');
    if (session.messageIds.includes(command.messageId)) return [];
    return [
      event(commandId, {
        type:
          command.type === 'appendUserMessage'
            ? 'UserMessageAppended'
            : 'AssistantMessageCommitted',
        messageId: command.messageId,
        establishesEvidence: command.establishesEvidence,
      }),
    ];
  }
  if (command.type === 'startGeneration') {
    if (session.state !== 'active') throw new LearningSessionError('session_not_writable');
    if (session.activeGenerationTaskId !== undefined) {
      throw new LearningSessionError('generation_in_progress');
    }
    return [event(commandId, { type: 'GenerationStarted', taskId: command.taskId })];
  }
  if (command.type === 'stopGeneration') {
    return session.activeGenerationTaskId === undefined
      ? []
      : [event(commandId, { type: 'GenerationStopped' })];
  }
  if (command.type === 'abandon') {
    return [
      event(commandId, {
        type: session.evidenceCheckpoint
          ? 'EvidencedLessonAbandoned'
          : 'EvidenceFreeLessonAbandoned',
      }),
    ];
  }
  if (command.type === 'commitFinalReview') {
    if (!session.evidenceCheckpoint) {
      throw new LearningSessionError('lesson_not_completable');
    }
    return [event(commandId, { type: 'FinalReviewCommitted', reviewId: command.reviewId })];
  }
  throw new LearningSessionError('session_not_writable');
}

function withoutActiveGeneration(session: OriginalLearningSession): OriginalLearningSession {
  const { activeGenerationTaskId: _task, ...rest } = session;
  void _task;
  return rest;
}

export function evolve(learning: LessonLearning, event: LearningSessionEvent): LessonLearning {
  const processedCommandIds = [...learning.processedCommandIds, event.commandId];
  if (event.type === 'OriginalSessionStarted') {
    return {
      ...learning,
      progress: 'in_progress',
      session: {
        id: event.sessionId,
        state: 'active',
        messageIds: [],
        evidenceCheckpoint: false,
      },
      processedCommandIds,
    };
  }
  if (event.type === 'EvidenceFreeLessonAbandoned') {
    const { session: _deleted, ...withoutSession } = learning;
    void _deleted;
    return { ...withoutSession, progress: 'not_started', processedCommandIds };
  }
  const session = learning.session;
  if (session === undefined) throw new LearningSessionError('session_not_writable');
  if (event.type === 'OriginalSessionPaused') {
    return { ...learning, session: { ...session, state: 'paused' }, processedCommandIds };
  }
  if (event.type === 'OriginalSessionResumed' || event.type === 'AbandonedLessonRestored') {
    return {
      ...learning,
      progress: 'in_progress',
      session: { ...session, state: 'active' },
      processedCommandIds,
    };
  }
  if (event.type === 'UserMessageAppended' || event.type === 'AssistantMessageCommitted') {
    return {
      ...learning,
      session: {
        ...session,
        messageIds: [...session.messageIds, event.messageId],
        evidenceCheckpoint: session.evidenceCheckpoint || event.establishesEvidence,
      },
      processedCommandIds,
    };
  }
  if (event.type === 'GenerationStarted') {
    return {
      ...learning,
      session: { ...session, activeGenerationTaskId: event.taskId },
      processedCommandIds,
    };
  }
  if (event.type === 'GenerationStopped') {
    return {
      ...learning,
      session: withoutActiveGeneration(session),
      processedCommandIds,
    };
  }
  if (event.type === 'StageReviewCommitted') {
    return {
      ...learning,
      session: { ...session, stageReviewId: event.reviewId },
      processedCommandIds,
    };
  }
  if (event.type === 'EvidencedLessonAbandoned') {
    return {
      ...learning,
      progress: 'abandoned',
      session: { ...withoutActiveGeneration(session), state: 'frozen' },
      processedCommandIds,
    };
  }
  if (event.type === 'FinalReviewCommitted') {
    return {
      ...learning,
      progress: 'completed',
      session: {
        ...withoutActiveGeneration(session),
        state: 'closed',
        finalReviewId: event.reviewId,
      },
      processedCommandIds,
    };
  }
  return learning;
}

export function evolveAll(
  learning: LessonLearning,
  events: readonly LearningSessionEvent[],
): LessonLearning {
  return events.reduce(evolve, learning);
}
