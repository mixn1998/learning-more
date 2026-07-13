import type { ReadModelStatus } from '../../interface.js';
import { createFactAccumulator, status } from './shared.js';

export type InteractionStatisticsView = ReadModelStatus &
  Readonly<{
    promptCount: number;
    responseCount: number;
    skipCount: number;
    interactionLessonCount: number;
    completedLessonCount: number;
    interactionLessonRate: number;
    responseRate: number;
    definitions: Readonly<Record<string, string>>;
  }>;

export function createInteractionProjection() {
  const accumulator = createFactAccumulator();
  return {
    apply: accumulator.apply,
    view(): InteractionStatisticsView {
      const facts = accumulator.facts();
      const prompted = facts.filter((fact) => fact.factType === 'InteractionPromptedFact');
      const responded = facts.filter((fact) => fact.factType === 'InteractionRespondedFact');
      const skipped = facts.filter((fact) => fact.factType === 'InteractionSkippedFact');
      const lessonIds = new Set(
        prompted
          .map((fact) => fact.subjectRefs.lessonId)
          .filter((value): value is string => value !== undefined),
      );
      const completedLessonIds = new Set(
        facts
          .filter((fact) => fact.factType === 'LessonCompletedFact')
          .map((fact) => fact.subjectRefs.lessonId)
          .filter((value): value is string => value !== undefined),
      );
      return {
        ...status(facts),
        promptCount: prompted.length,
        responseCount: responded.length,
        skipCount: skipped.length,
        interactionLessonCount: lessonIds.size,
        completedLessonCount: completedLessonIds.size,
        interactionLessonRate:
          completedLessonIds.size === 0 ? 0 : lessonIds.size / completedLessonIds.size,
        responseRate: prompted.length === 0 ? 0 : responded.length / prompted.length,
        definitions: {
          promptCount: 'metric.interaction.prompt_count',
          responseCount: 'metric.interaction.response_count',
          skipCount: 'metric.interaction.skip_count',
          interactionLessonCount: 'metric.interaction.lesson_count',
          interactionLessonRate: 'metric.interaction.lesson_rate',
          responseRate: 'metric.interaction.response_rate',
        },
      };
    },
  };
}
