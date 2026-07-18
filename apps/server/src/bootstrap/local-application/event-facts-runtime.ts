import { EVENT_TYPES } from '@learning-more/contracts';

import { createFactProjector } from '../../modules/learning-facts/implementation/fact-projector.js';
import { eventToFacts } from '../../modules/learning-facts/implementation/event-to-fact.js';
import { createCalendarProjection } from '../../modules/learning-facts/implementation/projections/calendar.js';
import { createCourseSummaryProjection } from '../../modules/learning-facts/implementation/projections/course-summary.js';
import { createHistoryProjection } from '../../modules/learning-facts/implementation/projections/history.js';
import { createStatisticsProjection } from '../../modules/learning-facts/implementation/projections/statistics.js';
import { createWeeklyProjection } from '../../modules/learning-facts/implementation/projections/weekly.js';
import type { LearningFact } from '../../modules/learning-facts/interface.js';
import type { DataRoot } from '../../persistence/data-root.js';
import { createEventDispatcher } from '../../persistence/event-dispatcher.js';
import { createEventLog } from '../../persistence/event-log.js';
import { createLocalFileFactRepository } from '../../persistence/learning-facts-repositories.js';
import { createOutbox } from '../../persistence/outbox.js';
import type { UnitOfWork } from '../../persistence/unit-of-work.js';

export type LocalEventFactsRuntime = Readonly<{
  outbox: ReturnType<typeof createOutbox>;
  factRepository: ReturnType<typeof createLocalFileFactRepository>;
  flush(): Promise<void>;
  facts(): Promise<readonly LearningFact[]>;
  historyView(): Promise<ReturnType<ReturnType<typeof createHistoryProjection>['view']>>;
  courseSummaryView(): Promise<
    ReturnType<ReturnType<typeof createCourseSummaryProjection>['view']>
  >;
  statisticsView(): Promise<ReturnType<ReturnType<typeof createStatisticsProjection>['view']>>;
  calendarView(): Promise<ReturnType<ReturnType<typeof createCalendarProjection>['view']>>;
  weeklyView(): Promise<ReturnType<ReturnType<typeof createWeeklyProjection>['view']>>;
}>;

export async function createLocalEventFactsRuntime(
  input: Readonly<{ dataRoot: DataRoot; unitOfWork: UnitOfWork }>,
): Promise<LocalEventFactsRuntime> {
  const eventLog = createEventLog(input.dataRoot);
  const eventDispatcher = createEventDispatcher();
  const factRepository = createLocalFileFactRepository(input.dataRoot);
  const factProjector = createFactProjector({
    repository: factRepository,
    unitOfWork: input.unitOfWork,
  });
  for (const eventType of EVENT_TYPES) {
    eventDispatcher.register(eventType, async (event) => {
      await factProjector.project(event);
    });
  }
  const durableFacts: LearningFact[] = [];
  for await (const fact of factRepository.list()) durableFacts.push(fact);
  const durableFactIds = new Set(durableFacts.map((fact) => fact.factId));
  const durableCourseIds = new Set(
    durableFacts.flatMap((fact) =>
      fact.subjectRefs.courseId === undefined ? [] : [fact.subjectRefs.courseId],
    ),
  );
  const events = await eventLog.readAll();
  const archivedCourseIds = new Set(
    events.flatMap((event) =>
      event.type === 'CourseArchiveDeleted' && event.target_refs.courseId !== undefined
        ? [event.target_refs.courseId]
        : [],
    ),
  );
  let recoveredFacts = false;
  for (const event of events) {
    const courseId = event.target_refs.courseId;
    if (event.type === 'CourseArchiveDeleted') {
      if (courseId !== undefined && durableCourseIds.has(courseId)) {
        await factProjector.project(event);
        recoveredFacts = true;
        durableCourseIds.delete(courseId);
      }
      continue;
    }
    if (courseId !== undefined && archivedCourseIds.has(courseId)) continue;
    const expectedFacts = eventToFacts(event);
    if (
      expectedFacts.length === 0 ||
      expectedFacts.every((fact) => durableFactIds.has(fact.factId))
    ) {
      continue;
    }
    await factProjector.project(event);
    recoveredFacts = true;
    for (const fact of expectedFacts) durableFactIds.add(fact.factId);
  }
  const outbox = createOutbox({
    dataRoot: input.dataRoot,
    unitOfWork: input.unitOfWork,
    eventLog,
    dispatcher: eventDispatcher,
  });
  let barrier: Promise<void> = Promise.resolve();
  let cachedFacts: readonly LearningFact[] | undefined = recoveredFacts ? undefined : durableFacts;
  let factsGeneration = 0;
  let factsLoad:
    Readonly<{ generation: number; promise: Promise<readonly LearningFact[]> }> | undefined;

  async function flush(): Promise<void> {
    const dispatch = barrier.then(async () => {
      const dispatched = await outbox.dispatchPending(10_000);
      if (dispatched > 0) {
        factsGeneration += 1;
        cachedFacts = undefined;
      }
    });
    barrier = dispatch.catch(() => undefined);
    await dispatch;
  }

  async function facts(): Promise<readonly LearningFact[]> {
    await flush();
    if (cachedFacts !== undefined) return cachedFacts;
    if (factsLoad?.generation !== factsGeneration) {
      factsLoad = {
        generation: factsGeneration,
        promise: (async () => {
          const result: LearningFact[] = [];
          for await (const fact of factRepository.list()) result.push(fact);
          return result;
        })(),
      };
    }
    const currentLoad = factsLoad;
    try {
      const result = await currentLoad.promise;
      if (currentLoad.generation === factsGeneration) cachedFacts = result;
      return result;
    } finally {
      if (factsLoad === currentLoad) factsLoad = undefined;
    }
  }

  await flush();
  return {
    outbox,
    factRepository,
    flush,
    facts,
    async historyView() {
      const projection = createHistoryProjection();
      projection.apply(await facts());
      return projection.view();
    },
    async courseSummaryView() {
      const projection = createCourseSummaryProjection();
      projection.apply(await facts());
      return projection.view();
    },
    async statisticsView() {
      const projection = createStatisticsProjection('Asia/Shanghai');
      projection.apply(await facts());
      return projection.view();
    },
    async calendarView() {
      const projection = createCalendarProjection('Asia/Shanghai');
      projection.apply(await facts());
      return projection.view();
    },
    async weeklyView() {
      const projection = createWeeklyProjection('Asia/Shanghai');
      projection.apply(await facts());
      return projection.view();
    },
  };
}
