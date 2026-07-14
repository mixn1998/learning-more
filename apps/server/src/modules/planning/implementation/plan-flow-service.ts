import { createHash, randomUUID } from 'node:crypto';

import type { CommandContext } from '@learning-more/contracts';

import { RepositoryVersionConflictError } from '../../../persistence/repository-errors.js';
import type { TransactionContext, UnitOfWork } from '../../../persistence/unit-of-work.js';
import type { PlanFlow, PlanSuggestion } from '../model/plan-flow.js';
import {
  overlaps,
  type ScheduleItem,
  validateScheduleInterval,
  validateTimeZone,
} from '../model/schedule-item.js';
import type { PlanFlowRepository } from '../ports/plan-flow-repository.js';
import type { ScheduleRepository } from '../ports/schedule-repository.js';
import { applyPlanFlowAction, type PlanFlowAction } from './plan-flow-policy.js';

class PlanFlowError extends Error {
  constructor(
    readonly code: 'plan_flow_not_found' | 'plan_preview_invalid' | 'plan_flow_not_confirmable',
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
  courses: readonly Readonly<{ courseId: string; title: string }>[];
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
    courseId: string;
    lessonId: string;
    startAt: string;
    endAt: string;
    timezoneAtCreation: string;
    locked?: boolean;
    status?: string;
  }>[];
  fixedCommitments: readonly Readonly<{
    courseId: string;
    lessonId: string;
    startAt: string;
    endAt: string;
    timezoneAtCreation: string;
  }>[];
}>;

const PLAN_PREVIEW_OUTPUT_EXAMPLE = {
  suggestions: [
    {
      courseId: 'course-reference',
      lessonId: 'lesson-reference',
      startAt: '2026-07-14T11:00:00.000Z',
      endAt: '2026-07-14T12:00:00.000Z',
      timezoneAtCreation: 'Asia/Shanghai',
      explanation: '为什么这个时段与顺序适合当前约束',
    },
  ],
} as const;

function renderPlanPreviewPrompt(context: PlanPreviewContext): string {
  const courses = context.courses.map(
    (course) => `- ${course.title}（课程标识：${course.courseId}）`,
  );
  const lessons = context.lessons.map((lesson) => {
    const prerequisites =
      lesson.prerequisiteLessonIds.length === 0
        ? '无前置课节'
        : `前置课节标识：${lesson.prerequisiteLessonIds.join('、')}`;
    return `- ${lesson.title}（课节标识：${lesson.lessonId}；课程标识：${lesson.courseId}）：${lesson.objective}；预计 ${lesson.estimatedMinutes} 分钟；${prerequisites}`;
  });
  const existing = context.existingSchedule
    .filter((item) => item.status !== 'removed')
    .map(
      (item) =>
        `- 课节标识 ${item.lessonId}：${item.startAt} 至 ${item.endAt}（${item.timezoneAtCreation}）${item.locked === true ? '；不可移动' : ''}`,
    );
  const availability = [
    context.availability.startLocalDate === undefined
      ? undefined
      : `最早开始日期：${context.availability.startLocalDate}`,
    context.availability.dailyTargetMinutes === undefined
      ? undefined
      : `单日目标时长：${context.availability.dailyTargetMinutes} 分钟`,
    context.availability.learningDays.length === 0
      ? undefined
      : `可学习日期：${context.availability.learningDays.join('、')}`,
    `时区：${context.timezone}`,
    `安排策略：${context.userPreferences.strategy}`,
    `保留已有日期：${context.userPreferences.preserveExistingDates ? '是' : '否'}`,
    `重新安排逾期任务：${context.userPreferences.rescheduleOverdue ? '是' : '否'}`,
  ].filter((value): value is string => value !== undefined);
  return [
    '只根据下面已物化的课程、课节、时间约束和现有安排提出可行学习计划。保持课节依赖，不要声称计划已经由用户确认。',
    '',
    '【机器输出契约】',
    '只返回一个 JSON 对象；suggestions 必须覆盖每个待规划课节，实体标识只能使用背景中提供的值。',
    JSON.stringify(PLAN_PREVIEW_OUTPUT_EXAMPLE),
    '',
    '【课程与待规划课节】',
    [...courses, ...lessons].join('\n'),
    '',
    '【可用时间与安排偏好】',
    availability.join('\n'),
    '',
    '【用户补充约束】',
    context.constraintsMarkdown?.trim() || '没有额外补充约束。',
    '',
    '【现有日程】',
    existing.length === 0 ? '当前没有需要避让的日程。' : existing.join('\n'),
  ].join('\n');
}

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
  generationRuntime: {
    submit(request: {
      taskKey: string;
      inputSnapshotHash: string;
      taskKind: string;
      taskGroup: 'background';
      ownerRef: string;
      providerId: string;
      priority: number;
      prompt: string;
    }): Promise<{ taskId: string }>;
  };
  assemblePreviewContext(input: PreviewInput): Promise<PlanPreviewContext>;
  getScheduleVersion(): Promise<number>;
  lessonIsPlannable(lessonId: string): Promise<boolean>;
  getLessonPrerequisiteIds?(lessonId: string): Promise<readonly string[]>;
  nextPlanFlowId(): string;
  nextScheduleItemId(): string;
  now(): Date;
  providerId?: string;
  recordConfirmed?: (
    items: readonly ScheduleItem[],
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

  async function save(flow: PlanFlow): Promise<PlanFlow> {
    await options.unitOfWork.execute(
      { transactionId: `tx_plan_flow_${randomUUID()}` },
      async (tx) => {
        await assertLessonRefsPlannable(flow.lessonRefs);
        await options.repository.save(tx, flow, flow.resourceVersion);
      },
    );
    return (await options.repository.get(flow.id))!;
  }

  async function validateSuggestions(
    flow: Pick<PlanFlow, 'courseRefs' | 'lessonRefs' | 'timeWindowRefs'>,
    suggestions: readonly PlanSuggestion[],
  ): Promise<void> {
    const lessonIds = new Set<string>();
    const allowedLessonIds = new Set(flow.lessonRefs);
    const allowedCourseIds = new Set(flow.courseRefs);
    const startDate = flow.timeWindowRefs.find((ref) => ref.startsWith('start:'))?.slice(6);
    const dailyMinutesText = flow.timeWindowRefs.find((ref) => ref.startsWith('daily:'))?.slice(6);
    const dailyMinutes = dailyMinutesText === undefined ? undefined : Number(dailyMinutesText);
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
      if (
        dailyMinutes !== undefined &&
        Number.isFinite(dailyMinutes) &&
        Date.parse(suggestion.endAt) - Date.parse(suggestion.startAt) > dailyMinutes * 60_000
      ) {
        throw new PlanFlowError('plan_preview_invalid');
      }
      lessonIds.add(suggestion.lessonId);
    }
    if (flow.lessonRefs.some((lessonId) => !lessonIds.has(lessonId))) {
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
  }

  return {
    async requestPreview(input: PreviewInput, commandId: string) {
      const id = options.nextPlanFlowId();
      const baseScheduleVersion = await options.getScheduleVersion();
      const materializedContext = await options.assemblePreviewContext(input);
      const inputManifest = { ...input, baseScheduleVersion, materializedContext };
      const inputSnapshotHash = hash(inputManifest);
      const prompt = renderPlanPreviewPrompt(materializedContext);
      const task = await options.generationRuntime.submit({
        taskKey: `plan-flow-preview:${id}:${commandId}`,
        inputSnapshotHash,
        taskKind: 'plan-flow-preview',
        taskGroup: 'background',
        ownerRef: id,
        providerId: options.providerId ?? 'current',
        priority: 30,
        prompt,
      });
      const timestamp = options.now().toISOString();
      return save({
        id,
        state: 'previewing',
        ...input,
        baseScheduleVersion,
        inputSnapshotHash,
        warnings: [],
        generationTaskId: task.taskId,
        suggestions: [],
        conflicts: [],
        confirmationReceipts: {},
        confirmedScheduleItemIds: [],
        source: 'plan-flow',
        createdAt: timestamp,
        updatedAt: timestamp,
        resourceVersion: 0,
      });
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
        scheduled.filter((item) => overlaps(item, suggestion)).map((item) => item.id),
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
      const confirmed: PlanFlow = {
        ...current,
        state: 'confirmed',
        lifecycleState: 'active',
        processedCommandIds: [...(current.processedCommandIds ?? []), context.commandId],
        confirmationReceipts: {
          ...current.confirmationReceipts,
          [context.commandId]: itemIds,
        },
        confirmedScheduleItemIds: itemIds,
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

    async manage(id: string, action: PlanFlowAction | 'end', context: CommandContext) {
      const current = await options.repository.get(id);
      if (current === undefined) throw new PlanFlowError('plan_flow_not_found');
      if (current.state !== 'confirmed') throw new PlanFlowError('plan_flow_not_confirmable');
      if ((current.processedCommandIds ?? []).includes(context.commandId)) return current;
      if (context.expectedVersion !== current.resourceVersion) {
        throw new RepositoryVersionConflictError(current.resourceVersion);
      }
      let lifecycleState: 'active' | 'paused' | 'deleted';
      try {
        lifecycleState = applyPlanFlowAction(
          current.lifecycleState ?? 'active',
          action === 'end' ? 'delete' : action,
        );
      } catch {
        throw new PlanFlowError('plan_flow_not_confirmable');
      }
      return save({
        ...current,
        lifecycleState,
        processedCommandIds: [...(current.processedCommandIds ?? []), context.commandId],
        updatedAt: options.now().toISOString(),
      });
    },

    get: (id: string) => options.repository.get(id),
  };
}
