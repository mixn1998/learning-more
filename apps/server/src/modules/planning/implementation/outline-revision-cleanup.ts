import type { TransactionContext } from '../../../persistence/unit-of-work.js';
import type {
  PlanningOutlineRevisionInput,
  PlanningOutlineRevisionParticipant,
} from '../interface.js';
import type { PlanFlowRepository } from '../ports/plan-flow-repository.js';
import type { ScheduleRepository } from '../ports/schedule-repository.js';

type ScheduleCancelledEvent = Readonly<{
  scheduleItemId: string;
  courseId: string;
  lessonId: string;
  reason: 'outline_revised';
  occurredAt: string;
}>;

type BatchPlanningOutlineRevisionParticipant = PlanningOutlineRevisionParticipant &
  Readonly<{
    retireOutlineReferencesBatch(
      inputs: readonly PlanningOutlineRevisionInput[],
      tx: TransactionContext,
    ): Promise<void>;
  }>;

const unconfirmedPlanFlowStates = new Set(['draft', 'previewing', 'preview-ready', 'confirming']);

export function createOutlineRevisionCleanup(options: {
  readonly schedules: ScheduleRepository;
  readonly planFlows: PlanFlowRepository;
  readonly recordScheduleCancelled?: (
    event: ScheduleCancelledEvent,
    tx: TransactionContext,
  ) => Promise<void>;
}): BatchPlanningOutlineRevisionParticipant {
  async function retireOutlineReferencesBatch(
    inputs: readonly PlanningOutlineRevisionInput[],
    tx: TransactionContext,
  ): Promise<void> {
    const revisions = new Map(
      inputs.map((input) => {
        const retained = new Set(input.retainedLessonIds);
        return [
          input.courseId,
          {
            ...input,
            retained,
            staleCourseLessons: new Set(
              input.knownCourseLessonIds.filter((lessonId) => !retained.has(lessonId)),
            ),
          },
        ];
      }),
    );

    for await (const item of options.schedules.list()) {
      const revision = revisions.get(item.courseId);
      if (
        revision === undefined ||
        item.status !== 'scheduled' ||
        revision.retained.has(item.lessonId)
      ) {
        continue;
      }
      await options.schedules.save(
        tx,
        {
          ...item,
          status: 'removed',
          cancelReason: 'outline_revised',
          updatedAt: revision.occurredAt,
          processedCommandIds: item.processedCommandIds.includes(revision.commandId)
            ? item.processedCommandIds
            : [...item.processedCommandIds, revision.commandId],
        },
        item.resourceVersion,
      );
      await options.recordScheduleCancelled?.(
        {
          scheduleItemId: item.id,
          courseId: item.courseId,
          lessonId: item.lessonId,
          reason: 'outline_revised',
          occurredAt: revision.occurredAt,
        },
        tx,
      );
    }

    for await (const flow of options.planFlows.list()) {
      if (!unconfirmedPlanFlowStates.has(flow.state)) continue;
      const relevant = [...revisions.values()].filter(
        (revision) =>
          flow.courseRefs.includes(revision.courseId) ||
          flow.suggestions.some((suggestion) => suggestion.courseId === revision.courseId),
      );
      if (relevant.length === 0) continue;
      const staleLessonIds = new Set(
        relevant.flatMap((revision) => [...revision.staleCourseLessons]),
      );
      await options.planFlows.save(
        tx,
        {
          ...flow,
          state: 'failed',
          errorCode: 'outline_revised',
          lessonRefs: flow.lessonRefs.filter((lessonId) => !staleLessonIds.has(lessonId)),
          suggestions: flow.suggestions.filter((suggestion) => {
            const revision = revisions.get(suggestion.courseId);
            return revision === undefined || revision.retained.has(suggestion.lessonId);
          }),
          updatedAt: relevant
            .map((revision) => revision.occurredAt)
            .sort()
            .at(-1)!,
          processedCommandIds: relevant.reduce<readonly string[]>(
            (commandIds, revision) =>
              commandIds.includes(revision.commandId)
                ? commandIds
                : [...commandIds, revision.commandId],
            flow.processedCommandIds ?? [],
          ),
        },
        flow.resourceVersion,
      );
    }
  }

  return {
    async retireOutlineReferences(input, tx) {
      await retireOutlineReferencesBatch([input], tx);
    },
    retireOutlineReferencesBatch,
  };
}
