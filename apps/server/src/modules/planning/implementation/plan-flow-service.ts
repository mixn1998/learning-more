import { createHash, randomUUID } from 'node:crypto';

import type { CommandContext } from '@learning-more/contracts';

import { RepositoryVersionConflictError } from '../../../persistence/repository-errors.js';
import type { TransactionContext, UnitOfWork } from '../../../persistence/unit-of-work.js';
import type { PlanFlow, PlanFlowScheduleMutation, PlanSuggestion } from '../model/plan-flow.js';
import {
  overlaps,
  type ScheduleItem,
  validateScheduleInterval,
  validateTimeZone,
} from '../model/schedule-item.js';
import type { PlanFlowRepository } from '../ports/plan-flow-repository.js';
import type { ScheduleRepository } from '../ports/schedule-repository.js';
import { buildPlanSuggestions } from './plan-flow-scheduler.js';

class PlanFlowError extends Error {
  constructor(
    readonly code:
      | 'plan_flow_not_found'
      | 'plan_preview_invalid'
      | 'plan_flow_not_confirmable'
      | 'plan_flow_nothing_to_undo'
      | 'plan_flow_undo_conflict',
  ) {
    super(code);
    this.name = 'PlanFlowError';
  }
}

type PreviewInput = Readonly<{
  constraintsArtifactRef: string;
  courseRefs: readonly string[];
  lessonRefs: readonly string[];
  timeWindowRefs: readonly string[];
  existingScheduleSnapshotRef: string;
}>;

export type PlanPreviewContext = Readonly<{
  courses: readonly Readonly<{
    courseId: string;
    title: string;
    lessonIds?: readonly string[];
  }>[];
  lessons: readonly Readonly<{
    lessonId: string;
    courseId: string;
    title: string;
    objective: string;
    prerequisiteLessonIds: readonly string[];
    estimatedMinutes: number;
    progress: 'not_started' | 'in_progress' | 'abandoned' | 'completed';
  }>[];
  timezone: string;
  availability: Readonly<{
    startLocalDate?: string | undefined;
    dailyTargetMinutes?: number | undefined;
    learningDays: readonly string[];
  }>;
  userPreferences: Readonly<{
    preserveExistingDates: boolean;
    rescheduleOverdue: boolean;
    strategy: string;
  }>;
  constraintsMarkdown?: string | undefined;
  existingSchedule: readonly Readonly<{
    id?: string;
    courseId: string;
    lessonId: string;
    startAt: string;
    endAt: string;
    timezoneAtCreation: string;
    locked?: boolean;
    status?: string;
  }>[];
  fixedCommitments: readonly Readonly<{
    id?: string;
    courseId: string;
    lessonId: string;
    startAt: string;
    endAt: string;
    timezoneAtCreation: string;
  }>[];
}>;

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function localDateAt(instant: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(instant));
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function localWeekdayAt(instant: string, timeZone: string): string {
  return new Intl.DateTimeFormat('zh-CN', { timeZone, weekday: 'short' }).format(new Date(instant));
}

export function createPlanFlowService(options: {
  repository: PlanFlowRepository;
  scheduleRepository: ScheduleRepository;
  unitOfWork: UnitOfWork;
  assemblePreviewContext(input: PreviewInput): Promise<PlanPreviewContext>;
  getScheduleVersion(): Promise<number>;
  lessonIsPlannable(lessonId: string): Promise<boolean>;
  getLessonPrerequisiteIds?(lessonId: string): Promise<readonly string[]>;
  getCourseLessonIds?(courseId: string): Promise<readonly string[]>;
  nextPlanFlowId(): string;
  nextScheduleItemId(): string;
  now(): Date;
  recordConfirmed?: (
    items: readonly ScheduleItem[],
    planFlowId: string,
    tx: TransactionContext,
  ) => Promise<void>;
  recordScheduleMutation?: (
    mutation: Readonly<{
      planned: readonly ScheduleItem[];
      cancelled: readonly ScheduleItem[];
    }>,
    planFlowId: string,
    tx: TransactionContext,
  ) => Promise<void>;
}) {
  async function assertLessonRefsPlannable(lessonIds: readonly string[]): Promise<void> {
    for (const lessonId of lessonIds) {
      if (!(await options.lessonIsPlannable(lessonId))) {
        throw new PlanFlowError('plan_preview_invalid');
      }
    }
  }

  async function save(flow: PlanFlow, assertPlannable = true): Promise<PlanFlow> {
    await options.unitOfWork.execute(
      { transactionId: `tx_plan_flow_${randomUUID()}` },
      async (tx) => {
        if (assertPlannable) await assertLessonRefsPlannable(flow.lessonRefs);
        await options.repository.save(tx, flow, flow.resourceVersion);
      },
    );
    return (await options.repository.get(flow.id))!;
  }

  async function validateSuggestions(
    flow: Pick<PlanFlow, 'courseRefs' | 'lessonRefs' | 'timeWindowRefs'>,
    suggestions: readonly PlanSuggestion[],
    expectedLessonIds: readonly string[] = flow.lessonRefs,
    ignoredScheduleItemIds: ReadonlySet<string> = new Set(),
  ): Promise<void> {
    const lessonIds = new Set<string>();
    const allowedLessonIds = new Set(expectedLessonIds);
    const allowedCourseIds = new Set(flow.courseRefs);
    const startDate = flow.timeWindowRefs.find((ref) => ref.startsWith('start:'))?.slice(6);
    const learningDays = new Set(
      flow.timeWindowRefs
        .find((ref) => ref.startsWith('days:'))
        ?.slice(5)
        .split(',')
        .filter(Boolean) ?? [],
    );
    for (const suggestion of suggestions) {
      try {
        validateScheduleInterval(suggestion.startAt, suggestion.endAt);
        validateTimeZone(suggestion.timezoneAtCreation);
      } catch {
        throw new PlanFlowError('plan_preview_invalid');
      }
      if (
        !(await options.lessonIsPlannable(suggestion.lessonId)) ||
        lessonIds.has(suggestion.lessonId) ||
        !allowedLessonIds.has(suggestion.lessonId) ||
        !allowedCourseIds.has(suggestion.courseId)
      ) {
        throw new PlanFlowError('plan_preview_invalid');
      }
      if (
        startDate !== undefined &&
        localDateAt(suggestion.startAt, suggestion.timezoneAtCreation) < startDate
      ) {
        throw new PlanFlowError('plan_preview_invalid');
      }
      if (
        learningDays.size > 0 &&
        !learningDays.has(localWeekdayAt(suggestion.startAt, suggestion.timezoneAtCreation))
      ) {
        throw new PlanFlowError('plan_preview_invalid');
      }
      lessonIds.add(suggestion.lessonId);
    }
    if (expectedLessonIds.some((lessonId) => !lessonIds.has(lessonId))) {
      throw new PlanFlowError('plan_preview_invalid');
    }
    for (const [index, suggestion] of suggestions.entries()) {
      for (const other of suggestions.slice(index + 1)) {
        if (overlaps(suggestion, other)) throw new PlanFlowError('plan_preview_invalid');
      }
      const prerequisiteIds = await options.getLessonPrerequisiteIds?.(suggestion.lessonId);
      for (const prerequisiteId of prerequisiteIds ?? []) {
        const prerequisite = suggestions.find((candidate) => candidate.lessonId === prerequisiteId);
        if (
          prerequisite !== undefined &&
          Date.parse(prerequisite.endAt) > Date.parse(suggestion.startAt)
        ) {
          throw new PlanFlowError('plan_preview_invalid');
        }
      }
    }

    const existing: ScheduleItem[] = [];
    for await (const item of options.scheduleRepository.list()) {
      if (item.status === 'scheduled' && !ignoredScheduleItemIds.has(item.id)) existing.push(item);
    }
    const suggestionLessonIds = new Set(suggestions.map((suggestion) => suggestion.lessonId));
    for (const courseId of flow.courseRefs) {
      const outlineOrder =
        (await options.getCourseLessonIds?.(courseId)) ??
        flow.lessonRefs.filter((lessonId) =>
          suggestions.some(
            (suggestion) => suggestion.lessonId === lessonId && suggestion.courseId === courseId,
          ),
        );
      const outlineIndex = new Map(outlineOrder.map((lessonId, index) => [lessonId, index]));
      const scheduledCourseLessons = [
        ...existing.filter(
          (item) => item.courseId === courseId && !suggestionLessonIds.has(item.lessonId),
        ),
        ...suggestions.filter((item) => item.courseId === courseId),
      ].sort((left, right) =>
        left.startAt === right.startAt
          ? left.endAt.localeCompare(right.endAt)
          : left.startAt.localeCompare(right.startAt),
      );
      let previousIndex = -1;
      for (const scheduledLesson of scheduledCourseLessons) {
        const currentIndex = outlineIndex.get(scheduledLesson.lessonId);
        if (currentIndex === undefined || currentIndex <= previousIndex) {
          throw new PlanFlowError('plan_preview_invalid');
        }
        previousIndex = currentIndex;
      }
    }
  }

  async function assertCompleteCourseSelection(
    input: PreviewInput,
    context: PlanPreviewContext,
  ): Promise<void> {
    const selected = new Set(input.lessonRefs);
    for (const course of context.courses) {
      if (!input.courseRefs.includes(course.courseId)) continue;
      for (const lessonId of course.lessonIds ?? []) {
        if ((await options.lessonIsPlannable(lessonId)) && !selected.has(lessonId)) {
          throw new PlanFlowError('plan_preview_invalid');
        }
      }
    }
  }

  async function loadScheduleItems(ids: readonly string[]): Promise<readonly ScheduleItem[]> {
    const items = await Promise.all(ids.map((id) => options.scheduleRepository.get(id)));
    return items.filter((item): item is ScheduleItem => item !== undefined);
  }

  async function undoLastScheduleMutation(
    current: PlanFlow,
    context: CommandContext,
  ): Promise<PlanFlow> {
    const mutation = current.lastScheduleMutation;
    if (mutation === undefined) throw new PlanFlowError('plan_flow_nothing_to_undo');
    const touchedItems = await loadScheduleItems(Object.keys(mutation.expectedScheduleVersions));
    if (
      touchedItems.length !== Object.keys(mutation.expectedScheduleVersions).length ||
      touchedItems.some(
        (item) => item.resourceVersion !== mutation.expectedScheduleVersions[item.id],
      )
    ) {
      throw new PlanFlowError('plan_flow_undo_conflict');
    }
    const createdIds = new Set(mutation.createdScheduleItemIds);
    const beforeIds = new Set(mutation.beforeScheduleItems.map((item) => item.id));
    const createdItems = touchedItems.filter((item) => createdIds.has(item.id));
    const currentBeforeItems = new Map(
      touchedItems.filter((item) => beforeIds.has(item.id)).map((item) => [item.id, item]),
    );
    if (
      createdItems.some(
        (item) =>
          item.status !== 'scheduled' || item.source !== 'plan-flow' || item.locked === true,
      ) ||
      mutation.beforeScheduleItems.some(
        (item) => currentBeforeItems.get(item.id)?.status !== 'removed',
      )
    ) {
      throw new PlanFlowError('plan_flow_undo_conflict');
    }

    const activeOtherItems: ScheduleItem[] = [];
    for await (const item of options.scheduleRepository.list()) {
      if (item.status === 'scheduled' && !createdIds.has(item.id) && !beforeIds.has(item.id)) {
        activeOtherItems.push(item);
      }
    }
    if (
      mutation.beforeScheduleItems.some((before) =>
        activeOtherItems.some((other) => overlaps(before, other)),
      )
    ) {
      throw new PlanFlowError('plan_flow_undo_conflict');
    }

    const timestamp = options.now().toISOString();
    const cancelled = createdItems.map((item): ScheduleItem => ({
      ...item,
      status: 'removed',
      cancelReason: 'plan_flow_undone',
      updatedAt: timestamp,
      processedCommandIds: [...item.processedCommandIds, context.commandId],
    }));
    const restored = mutation.beforeScheduleItems.map((snapshot): ScheduleItem => {
      const currentItem = currentBeforeItems.get(snapshot.id)!;
      const { cancelReason: _cancelReason, ...withoutCancelReason } = snapshot;
      void _cancelReason;
      return {
        ...withoutCancelReason,
        status: 'scheduled',
        updatedAt: timestamp,
        resourceVersion: currentItem.resourceVersion,
        processedCommandIds: [...new Set([...currentItem.processedCommandIds, context.commandId])],
      };
    });
    const scheduleVersionAfterUndo =
      (await options.getScheduleVersion()) + cancelled.length + restored.length;
    const { lastScheduleMutation: _lastScheduleMutation, ...flowWithoutMutation } = current;
    void _lastScheduleMutation;
    const next: PlanFlow = {
      ...flowWithoutMutation,
      state: mutation.beforeState,
      suggestions: mutation.beforeSuggestions,
      confirmedScheduleItemIds: mutation.beforeConfirmedScheduleItemIds,
      baseScheduleVersion:
        mutation.beforeState === 'preview-ready'
          ? scheduleVersionAfterUndo
          : current.baseScheduleVersion,
      processedCommandIds: [...(current.processedCommandIds ?? []), context.commandId],
      updatedAt: timestamp,
    };
    await options.unitOfWork.execute(
      { transactionId: `tx_undo_plan_flow_${current.id}_${randomUUID()}` },
      async (tx) => {
        for (const item of cancelled) {
          await options.scheduleRepository.save(tx, item, item.resourceVersion);
        }
        for (const item of restored) {
          await options.scheduleRepository.save(tx, item, item.resourceVersion);
        }
        await options.recordScheduleMutation?.({ planned: restored, cancelled }, current.id, tx);
        await options.repository.save(tx, next, current.resourceVersion);
      },
    );
    return (await options.repository.get(current.id))!;
  }

  return {
    async requestPreview(input: PreviewInput, commandId: string) {
      void commandId;
      const id = options.nextPlanFlowId();
      const baseScheduleVersion = await options.getScheduleVersion();
      const materializedContext = await options.assemblePreviewContext(input);
      await assertCompleteCourseSelection(input, materializedContext);
      const preservedLessonIds = new Set(
        materializedContext.userPreferences.preserveExistingDates
          ? materializedContext.existingSchedule
              .filter((item) => item.status !== 'removed')
              .map((item) => item.lessonId)
          : [],
      );
      const effectiveInput = {
        ...input,
        lessonRefs: input.lessonRefs.filter((lessonId) => !preservedLessonIds.has(lessonId)),
      };
      const effectiveContext = {
        ...materializedContext,
        lessons: materializedContext.lessons.filter((lesson) =>
          effectiveInput.lessonRefs.includes(lesson.lessonId),
        ),
      };
      const inputManifest = {
        ...effectiveInput,
        baseScheduleVersion,
        materializedContext: effectiveContext,
      };
      const inputSnapshotHash = hash(inputManifest);
      const timestamp = options.now().toISOString();
      let suggestions: readonly PlanSuggestion[];
      try {
        suggestions = buildPlanSuggestions(effectiveContext, effectiveInput.lessonRefs);
      } catch {
        throw new PlanFlowError('plan_preview_invalid');
      }
      const preview: PlanFlow = {
        id,
        state: 'preview-ready',
        ...effectiveInput,
        baseScheduleVersion,
        inputSnapshotHash,
        warnings: [],
        generationTaskId: `rules_${inputSnapshotHash.slice(0, 24)}`,
        suggestions,
        conflicts: [],
        confirmationReceipts: {},
        confirmedScheduleItemIds: [],
        source: 'plan-flow',
        createdAt: timestamp,
        updatedAt: timestamp,
        resourceVersion: 0,
      };
      await validateSuggestions(preview, suggestions);
      const scheduled: ScheduleItem[] = [];
      for await (const item of options.scheduleRepository.list()) {
        if (item.status === 'scheduled') scheduled.push(item);
      }
      const conflicts = suggestions.flatMap((suggestion) =>
        scheduled
          .filter((item) => item.lessonId === suggestion.lessonId || overlaps(item, suggestion))
          .map((item) => item.id),
      );
      return save({ ...preview, conflicts: [...new Set(conflicts)].sort() });
    },

    async fail(id: string, errorCode: string, draftArtifactRef: string) {
      const current = await options.repository.get(id);
      if (current === undefined) throw new PlanFlowError('plan_flow_not_found');
      return save({
        ...current,
        state: 'failed',
        errorCode,
        draftArtifactRef,
        updatedAt: options.now().toISOString(),
      });
    },

    async markPreviewReady(id: string, suggestions: readonly PlanSuggestion[]) {
      const current = await options.repository.get(id);
      if (current === undefined) throw new PlanFlowError('plan_flow_not_found');
      await validateSuggestions(current, suggestions);
      const scheduled: ScheduleItem[] = [];
      for await (const item of options.scheduleRepository.list()) {
        if (item.status === 'scheduled') scheduled.push(item);
      }
      const conflicts = suggestions.flatMap((suggestion) =>
        scheduled
          .filter((item) => item.lessonId === suggestion.lessonId || overlaps(item, suggestion))
          .map((item) => item.id),
      );
      const { errorCode: _error, draftArtifactRef: _draft, ...withoutFailure } = current;
      void _error;
      void _draft;
      return save({
        ...withoutFailure,
        state: 'preview-ready',
        suggestions,
        conflicts: [...new Set(conflicts)].sort(),
        updatedAt: options.now().toISOString(),
      });
    },

    async confirm(id: string, context: CommandContext) {
      const current = await options.repository.get(id);
      if (current === undefined) throw new PlanFlowError('plan_flow_not_found');
      if (current.state === 'confirmed') return current;
      if (current.state !== 'preview-ready') {
        throw new PlanFlowError('plan_flow_not_confirmable');
      }
      if (context.expectedVersion !== current.resourceVersion) {
        throw new RepositoryVersionConflictError(current.resourceVersion);
      }
      const scheduleVersion = await options.getScheduleVersion();
      if (scheduleVersion !== current.baseScheduleVersion) {
        throw new RepositoryVersionConflictError(scheduleVersion);
      }
      if (current.conflicts.length > 0) throw new PlanFlowError('plan_flow_not_confirmable');

      const timestamp = options.now().toISOString();
      const scheduleItems: ScheduleItem[] = current.suggestions.map((suggestion) => ({
        id: options.nextScheduleItemId(),
        courseId: suggestion.courseId,
        lessonId: suggestion.lessonId,
        startAt: suggestion.startAt,
        endAt: suggestion.endAt,
        timezoneAtCreation: suggestion.timezoneAtCreation,
        source: 'plan-flow',
        status: 'scheduled',
        locked: false,
        createdAt: timestamp,
        updatedAt: timestamp,
        processedCommandIds: [context.commandId],
        resourceVersion: 0,
      }));
      const itemIds = scheduleItems.map((item) => item.id);
      const expectedScheduleVersions = Object.fromEntries(
        scheduleItems.map((item) => [item.id, item.resourceVersion + 1]),
      );
      const lastScheduleMutation: PlanFlowScheduleMutation = {
        kind: 'confirm',
        occurredAt: timestamp,
        beforeState: current.state,
        beforeSuggestions: current.suggestions,
        beforeConfirmedScheduleItemIds: current.confirmedScheduleItemIds,
        beforeScheduleItems: [],
        createdScheduleItemIds: itemIds,
        expectedScheduleVersions,
      };
      const confirmed: PlanFlow = {
        ...current,
        state: 'confirmed',
        processedCommandIds: [...(current.processedCommandIds ?? []), context.commandId],
        confirmationReceipts: {
          ...current.confirmationReceipts,
          [context.commandId]: itemIds,
        },
        confirmedScheduleItemIds: itemIds,
        lastScheduleMutation,
        updatedAt: timestamp,
      };
      await options.unitOfWork.execute(
        { transactionId: `tx_confirm_plan_flow_${current.id}` },
        async (tx) => {
          await assertLessonRefsPlannable(current.lessonRefs);
          await validateSuggestions(current, current.suggestions);
          for (const item of scheduleItems) {
            await options.scheduleRepository.save(tx, item, 0);
          }
          await options.recordConfirmed?.(scheduleItems, current.id, tx);
          await options.repository.save(tx, confirmed, current.resourceVersion);
        },
      );
      return (await options.repository.get(id))!;
    },

    async manage(id: string, action: 'undo', context: CommandContext) {
      const current = await options.repository.get(id);
      if (current === undefined) throw new PlanFlowError('plan_flow_not_found');
      if (current.state !== 'confirmed') throw new PlanFlowError('plan_flow_not_confirmable');
      if ((current.processedCommandIds ?? []).includes(context.commandId)) return current;
      if (context.expectedVersion !== current.resourceVersion) {
        throw new RepositoryVersionConflictError(current.resourceVersion);
      }
      void action;
      return undoLastScheduleMutation(current, context);
    },

    get: (id: string) => options.repository.get(id),
  };
}
