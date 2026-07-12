import type { CommandContext, CommandResult, QueryContext } from '@learning-more/contracts';

import type { LearningSessionCommand as DomainCommand } from './model/commands.js';
import type { LessonLearning } from './model/learning-session.js';

export type LearningSessionCommand = Readonly<{
  lessonId: string;
  action: DomainCommand;
}>;

export type LearningSessionQuery = Readonly<{
  type: 'GetLessonLearning';
  lessonId: string;
}>;

export type LearningSessionResult = Readonly<{
  lessonId: string;
  progress: LessonLearning['progress'];
  sessionId?: string;
  resourceVersion: number;
}>;

export type LearningSessionView = LessonLearning & Readonly<{ resourceVersion: number }>;

export interface LearningSessionModule {
  execute(
    command: LearningSessionCommand,
    context: CommandContext,
  ): Promise<CommandResult<LearningSessionResult>>;
  query(query: LearningSessionQuery, context: QueryContext): Promise<LearningSessionView>;
}
