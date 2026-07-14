import type { PersonalizationView } from '@learning-more/contracts';

import type {
  MaterializedTeachingMessage,
  TeachingContextAssembler,
  TeachingContextPackage,
  TeachingContextSources,
} from '../ports/teaching-context-sources.js';

function estimatedCharacters(value: unknown): number {
  return JSON.stringify(value).length;
}

function emptyPersonalization(view: PersonalizationView): PersonalizationView {
  return { ...view, signals: [] };
}

export function createTeachingContextAssembler(options: {
  sources: TeachingContextSources;
  maxContextCharacters?: number;
}): TeachingContextAssembler {
  return {
    async assemble(input): Promise<TeachingContextPackage> {
      const [
        courseAndLesson,
        allMessages,
        reviews,
        materials,
        learningStartSummary,
        personalization,
      ] = await Promise.all([
        options.sources.getCourseAndLesson({
          courseId: input.courseId,
          lessonId: input.lessonId,
        }),
        options.sources.listMessages(input.sessionId),
        options.sources.listRelevantFinalReviews(input.courseId, input.lessonId),
        options.sources.listRelevantMaterialExcerpts(input.lessonId),
        options.sources.getLearningStartSummary(input.courseId),
        options.sources.getPersonalizationView({
          courseId: input.courseId,
          lessonId: input.lessonId,
        }),
      ]);

      if (courseAndLesson.course.courseId !== input.courseId) {
        throw new Error('teaching_course_context_mismatch');
      }
      if (courseAndLesson.lesson.lessonId !== input.lessonId) {
        throw new Error('teaching_lesson_context_mismatch');
      }
      if (
        courseAndLesson.course.courseMode === 'standard' &&
        courseAndLesson.course.playIntent !== undefined
      ) {
        throw new Error('standard_mode_play_intent_forbidden');
      }
      const currentMessage = allMessages.find(
        (message) => message.messageId === input.currentUserMessageId && message.role === 'user',
      );
      if (currentMessage === undefined) throw new Error('current_user_message_not_materialized');

      const unobservedIds = new Set(input.unobservedMessageIds);
      let context: TeachingContextPackage = {
        schemaVersion: 1,
        course: courseAndLesson.course,
        lesson: courseAndLesson.lesson,
        ...(learningStartSummary === undefined ? {} : { learningStartSummary }),
        relevantFinalReviews: [...reviews],
        readingMaterialExcerpts: [...materials],
        personalization,
        teachingState: input.teachingState,
        recentMessages: [...allMessages],
        unobservedMessages: allMessages.filter((message) => unobservedIds.has(message.messageId)),
      };

      const budget = options.maxContextCharacters ?? 200_000;
      if (estimatedCharacters(context) <= budget) return context;

      context = { ...context, personalization: emptyPersonalization(context.personalization) };
      while (estimatedCharacters(context) > budget && context.relevantFinalReviews.length > 0) {
        context = { ...context, relevantFinalReviews: context.relevantFinalReviews.slice(1) };
      }
      while (estimatedCharacters(context) > budget) {
        const removableIndex = context.recentMessages.findIndex(
          (message) =>
            message.messageId !== input.currentUserMessageId &&
            !unobservedIds.has(message.messageId),
        );
        if (removableIndex === -1) break;
        context = {
          ...context,
          recentMessages: context.recentMessages.filter((_, index) => index !== removableIndex),
        };
      }
      while (estimatedCharacters(context) > budget && context.readingMaterialExcerpts.length > 1) {
        context = {
          ...context,
          readingMaterialExcerpts: context.readingMaterialExcerpts.slice(0, -1),
        };
      }
      if (estimatedCharacters(context) > budget && context.learningStartSummary !== undefined) {
        const { learningStartSummary: _summary, ...withoutSummary } = context;
        void _summary;
        context = withoutSummary;
      }

      const protectedMessages: readonly MaterializedTeachingMessage[] = [
        currentMessage,
        ...context.unobservedMessages.filter(
          (message) => message.messageId !== currentMessage.messageId,
        ),
      ];
      const protectedIds = new Set(protectedMessages.map((message) => message.messageId));
      if (
        !context.recentMessages.some((message) => message.messageId === currentMessage.messageId) ||
        context.unobservedMessages.some((message) => !protectedIds.has(message.messageId))
      ) {
        throw new Error('protected_teaching_context_trimmed');
      }
      return context;
    },
  };
}
