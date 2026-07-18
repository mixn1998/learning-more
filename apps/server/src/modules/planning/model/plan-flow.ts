import type { ScheduleSource } from './schedule-item.js';
import type { ScheduleItem } from './schedule-item.js';

export type PlanFlowState =
  'draft' | 'previewing' | 'preview-ready' | 'confirming' | 'confirmed' | 'failed' | 'cancelled';

export type PlanSuggestion = Readonly<{
  courseId: string;
  lessonId: string;
  startAt: string;
  endAt: string;
  timezoneAtCreation: string;
  explanation: string;
}>;

export type PlanFlowScheduleMutation = Readonly<{
  kind: 'confirm' | 'reflow';
  occurredAt: string;
  beforeState: PlanFlowState;
  beforeLifecycleState?: 'active' | 'paused' | 'deleted';
  beforeSuggestions: readonly PlanSuggestion[];
  beforeConfirmedScheduleItemIds: readonly string[];
  beforeScheduleItems: readonly ScheduleItem[];
  createdScheduleItemIds: readonly string[];
  expectedScheduleVersions: Readonly<Record<string, number>>;
}>;

export type PlanFlow = Readonly<{
  id: string;
  state: PlanFlowState;
  constraintsArtifactRef: string;
  courseRefs: readonly string[];
  lessonRefs: readonly string[];
  timeWindowRefs: readonly string[];
  existingScheduleSnapshotRef: string;
  baseScheduleVersion: number;
  inputSnapshotHash?: string;
  warnings?: readonly string[];
  generationTaskId: string;
  suggestions: readonly PlanSuggestion[];
  conflicts: readonly string[];
  confirmationReceipts: Readonly<Record<string, readonly string[]>>;
  confirmedScheduleItemIds: readonly string[];
  lastScheduleMutation?: PlanFlowScheduleMutation;
  lifecycleState?: 'active' | 'paused' | 'deleted';
  processedCommandIds?: readonly string[];
  source: ScheduleSource;
  errorCode?: string;
  draftArtifactRef?: string;
  createdAt: string;
  updatedAt: string;
  resourceVersion: number;
}>;
