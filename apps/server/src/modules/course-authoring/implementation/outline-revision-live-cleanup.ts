import type { TransactionContext } from '../../../persistence/unit-of-work.js';
import type { PlanFlowRepository } from '../../planning/ports/plan-flow-repository.js';
import type { ScheduleRepository } from '../../planning/ports/schedule-repository.js';

type CleanupInput = Readonly<{
  courseId: string;
  retainedLessonIds: readonly string[];
  knownCourseLessonIds: readonly string[];
  commandId: string;
  occurredAt: string;
}>;

type ScheduleCancelledEvent = Readonly<{
  scheduleItemId: string;
  courseId: string;
  lessonId: string;
  reason: 'outline_revised';
  occurredAt: string;
}>;

export interface OutlineRevisionLiveCleanup {
  retire(input: CleanupInput, tx: TransactionContext): Promise<void>;
}

const unconfirmedPlanFlowStates = new Set([
  'draft',
  'previewing',
  'preview-ready',
  'confirming',
]);

export function createOutlineRevisionLiveCleanup(options: {
  readonly schedules: ScheduleRepository;
  readonly planFlows: PlanFlowRepository;
  readonly recordScheduleCancelled?: (
    event: ScheduleCancelledEvent,
    tx: TransactionContext,
  ) => Promise<void>;
}): OutlineRevisionLiveCleanup {
  return {
    async retire(input, tx) {
      const retained = new Set(input.retainedLessonIds);
      const staleCourseLessons = new Set(
        input.knownCourseLessonIds.filter((lessonId) => !retained.has(lessonId)),
      );

      for await (const item of options.schedules.list()) {
        if (
          item.courseId !== input.courseId ||
          item.status !== 'scheduled' ||
          retained.has(item.lessonId)
        ) {
          continue;
        }
        await options.schedules.save(
          tx,
          {
            ...item,
            status: 'removed',
            cancelReason: 'outline_revised',
            updatedAt: input.occurredAt,
            processedCommandIds: item.processedCommandIds.includes(input.commandId)
              ? item.processedCommandIds
              : [...item.processedCommandIds, input.commandId],
          },
          item.resourceVersion,
        );
        await options.recordScheduleCancelled?.(
          {
            scheduleItemId: item.id,
            courseId: item.courseId,
            lessonId: item.lessonId,
            reason: 'outline_revised',
            occurredAt: input.occurredAt,
          },
          tx,
        );
      }

      for await (const flow of options.planFlows.list()) {
        const referencesCourse =
          flow.courseRefs.includes(input.courseId) ||
          flow.suggestions.some((suggestion) => suggestion.courseId === input.courseId);
        if (!referencesCourse || !unconfirmedPlanFlowStates.has(flow.state)) continue;
        const processedCommandIds = flow.processedCommandIds ?? [];
        await options.planFlows.save(
          tx,
          {
            ...flow,
            state: 'failed',
            errorCode: 'outline_revised',
            lessonRefs: flow.lessonRefs.filter((lessonId) => !staleCourseLessons.has(lessonId)),
            suggestions: flow.suggestions.filter(
              (suggestion) =>
                suggestion.courseId !== input.courseId || retained.has(suggestion.lessonId),
            ),
            updatedAt: input.occurredAt,
            processedCommandIds: processedCommandIds.includes(input.commandId)
              ? processedCommandIds
              : [...processedCommandIds, input.commandId],
          },
          flow.resourceVersion,
        );
      }
    },
  };
}
