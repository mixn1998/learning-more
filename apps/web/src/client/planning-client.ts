import {
  PlanFlowViewSchema,
  CatalogIndexResponseSchema,
  ScheduleAssignmentResponseSchema,
  ScheduleViewResponseSchema,
  type HomeDashboardView,
  type PlanFlowView,
  type ScheduleItemView as ContractScheduleItemView,
} from '@learning-more/contracts';

import { apiRequest, type CommandAttempt } from './api-client.js';

export type ScheduleItemView = ContractScheduleItemView;
export type PlanFlowPreviewView = PlanFlowView;
export type PlanFlowAction = 'undo';

type CreateScheduleInput = Readonly<{
  courseId: string;
  lessonId: string;
  startAt: string;
  endAt: string;
  timezoneAtCreation: string;
}>;

export interface PlanningClient {
  getSchedule(): Promise<{ items: readonly ScheduleItemView[]; resourceVersion: number }>;
  getPlanningContext(): Promise<Pick<HomeDashboardView, 'courses' | 'lessons'>>;
  clearSchedule(
    scheduleItemIds: readonly string[],
    resourceVersion: number,
    command: CommandAttempt,
  ): Promise<{ items: readonly ScheduleItemView[]; resourceVersion: number }>;
  createSchedule(
    input: CreateScheduleInput,
    command: CommandAttempt,
  ): Promise<{ scheduleItem: ScheduleItemView }>;
  moveSchedule(
    scheduleItemId: string,
    resourceVersion: number,
    startAt: string,
    endAt: string,
    command: CommandAttempt,
  ): Promise<{ scheduleItem: ScheduleItemView }>;
  resizeSchedule(
    scheduleItemId: string,
    resourceVersion: number,
    endAt: string,
    command: CommandAttempt,
  ): Promise<{ scheduleItem: ScheduleItemView }>;
  setScheduleLock(
    scheduleItemId: string,
    resourceVersion: number,
    locked: boolean,
    command: CommandAttempt,
  ): Promise<{ scheduleItem: ScheduleItemView }>;
  removeSchedule(
    scheduleItemId: string,
    resourceVersion: number,
    command: CommandAttempt,
  ): Promise<{ scheduleItem: ScheduleItemView }>;
  requestPreview(
    input: {
      constraintsArtifactRef: string;
      courseRefs: readonly string[];
      lessonRefs: readonly string[];
      timeWindowRefs: readonly string[];
      existingScheduleSnapshotRef: string;
    },
    command: CommandAttempt,
  ): Promise<PlanFlowPreviewView>;
  confirmPlanFlow(
    planFlowId: string,
    resourceVersion: number,
    command: CommandAttempt,
  ): Promise<PlanFlowPreviewView>;
  getPlanFlow(planFlowId: string): Promise<PlanFlowPreviewView>;
  managePlanFlow(
    planFlowId: string,
    resourceVersion: number,
    action: PlanFlowAction,
    command: CommandAttempt,
  ): Promise<PlanFlowPreviewView>;
}

async function scheduleCommand(
  scheduleItemId: string,
  resourceVersion: number,
  method: 'PATCH' | 'DELETE',
  command: CommandAttempt,
  body?: unknown,
) {
  return (
    await apiRequest(`/api/v1/schedule-assignments/${encodeURIComponent(scheduleItemId)}`, {
      method,
      ...(body === undefined ? {} : { body }),
      schema: ScheduleAssignmentResponseSchema,
      command,
      resourceVersion,
    })
  ).data;
}

export const planningClient: PlanningClient = {
  async getSchedule() {
    return (await apiRequest('/api/v1/schedule', { schema: ScheduleViewResponseSchema })).data;
  },
  async getPlanningContext() {
    const view = (
      await apiRequest('/api/v1/planning-context', {
        schema: CatalogIndexResponseSchema,
      })
    ).data;
    return { courses: view.courses, lessons: view.lessons };
  },
  async clearSchedule(scheduleItemIds, resourceVersion, command) {
    return (
      await apiRequest('/api/v1/schedule', {
        method: 'DELETE',
        body: { scheduleItemIds },
        schema: ScheduleViewResponseSchema,
        command,
        resourceVersion,
      })
    ).data;
  },
  async createSchedule(input, command) {
    return (
      await apiRequest('/api/v1/schedule-assignments', {
        method: 'POST',
        body: input,
        schema: ScheduleAssignmentResponseSchema,
        command,
      })
    ).data;
  },
  moveSchedule(scheduleItemId, resourceVersion, startAt, endAt, command) {
    return scheduleCommand(scheduleItemId, resourceVersion, 'PATCH', command, {
      action: 'move',
      startAt,
      endAt,
    });
  },
  resizeSchedule(scheduleItemId, resourceVersion, endAt, command) {
    return scheduleCommand(scheduleItemId, resourceVersion, 'PATCH', command, {
      action: 'resize',
      endAt,
    });
  },
  setScheduleLock(scheduleItemId, resourceVersion, locked, command) {
    return scheduleCommand(scheduleItemId, resourceVersion, 'PATCH', command, {
      action: 'set-lock',
      locked,
    });
  },
  removeSchedule(scheduleItemId, resourceVersion, command) {
    return scheduleCommand(scheduleItemId, resourceVersion, 'DELETE', command);
  },
  async requestPreview(input, command) {
    return (
      await apiRequest('/api/v1/plan-flow-previews', {
        method: 'POST',
        body: input,
        schema: PlanFlowViewSchema,
        command,
      })
    ).data;
  },
  async confirmPlanFlow(planFlowId, resourceVersion, command) {
    return (
      await apiRequest('/api/v1/plan-flows', {
        method: 'POST',
        body: { planFlowId },
        schema: PlanFlowViewSchema,
        command,
        resourceVersion,
      })
    ).data;
  },
  async getPlanFlow(planFlowId) {
    return (
      await apiRequest(`/api/v1/plan-flows/${encodeURIComponent(planFlowId)}`, {
        schema: PlanFlowViewSchema,
      })
    ).data;
  },
  async managePlanFlow(planFlowId, resourceVersion, action, command) {
    return (
      await apiRequest(`/api/v1/plan-flows/${encodeURIComponent(planFlowId)}/actions`, {
        method: 'POST',
        body: { action },
        schema: PlanFlowViewSchema,
        command,
        resourceVersion,
      })
    ).data;
  },
};
