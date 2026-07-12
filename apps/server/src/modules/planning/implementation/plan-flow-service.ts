import { createHash, randomUUID } from 'node:crypto';

import type { CommandContext } from '@learning-more/contracts';

import { RepositoryVersionConflictError } from '../../../persistence/repository-errors.js';
import type { UnitOfWork } from '../../../persistence/unit-of-work.js';
import type { PlanFlow, PlanSuggestion } from '../model/plan-flow.js';
import {
  overlaps,
  type ScheduleItem,
  validateScheduleInterval,
  validateTimeZone,
} from '../model/schedule-item.js';
import type { PlanFlowRepository } from '../ports/plan-flow-repository.js';
import type { ScheduleRepository } from '../ports/schedule-repository.js';

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

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
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
  getScheduleVersion(): Promise<number>;
  lessonExists(lessonId: string): Promise<boolean>;
  nextPlanFlowId(): string;
  nextScheduleItemId(): string;
  now(): Date;
  providerId?: string;
}) {
  async function save(flow: PlanFlow): Promise<PlanFlow> {
    await options.unitOfWork.execute({ transactionId: `tx_plan_flow_${randomUUID()}` }, (tx) =>
      options.repository.save(tx, flow, flow.resourceVersion),
    );
    return (await options.repository.get(flow.id))!;
  }

  async function validateSuggestions(suggestions: readonly PlanSuggestion[]): Promise<void> {
    const lessonIds = new Set<string>();
    for (const suggestion of suggestions) {
      try {
        validateScheduleInterval(suggestion.startAt, suggestion.endAt);
        validateTimeZone(suggestion.timezoneAtCreation);
      } catch {
        throw new PlanFlowError('plan_preview_invalid');
      }
      if (
        !(await options.lessonExists(suggestion.lessonId)) ||
        lessonIds.has(suggestion.lessonId)
      ) {
        throw new PlanFlowError('plan_preview_invalid');
      }
      lessonIds.add(suggestion.lessonId);
    }
  }

  return {
    async requestPreview(input: PreviewInput, commandId: string) {
      const id = options.nextPlanFlowId();
      const baseScheduleVersion = await options.getScheduleVersion();
      const inputManifest = { ...input, baseScheduleVersion };
      const task = await options.generationRuntime.submit({
        taskKey: `plan-flow-preview:${id}:${commandId}`,
        inputSnapshotHash: hash(inputManifest),
        taskKind: 'plan-flow-preview',
        taskGroup: 'background',
        ownerRef: id,
        providerId: options.providerId ?? 'current',
        priority: 30,
        prompt: JSON.stringify({
          templateRef: 'plan-flow-preview@v1',
          inputManifest,
        }),
      });
      const timestamp = options.now().toISOString();
      return save({
        id,
        state: 'previewing',
        ...input,
        baseScheduleVersion,
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
      await validateSuggestions(suggestions);
      const scheduled: ScheduleItem[] = [];
      for await (const item of options.scheduleRepository.list()) {
        if (item.status === 'scheduled') scheduled.push(item);
      }
      const conflicts = suggestions.flatMap((suggestion) =>
        scheduled
          .filter((item) => item.lessonId === suggestion.lessonId && overlaps(item, suggestion))
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
        createdAt: timestamp,
        updatedAt: timestamp,
        processedCommandIds: [context.commandId],
        resourceVersion: 0,
      }));
      const itemIds = scheduleItems.map((item) => item.id);
      const confirmed: PlanFlow = {
        ...current,
        state: 'confirmed',
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
          for (const item of scheduleItems) {
            await options.scheduleRepository.save(tx, item, 0);
          }
          await options.repository.save(tx, confirmed, current.resourceVersion);
        },
      );
      return (await options.repository.get(id))!;
    },

    get: (id: string) => options.repository.get(id),
  };
}
