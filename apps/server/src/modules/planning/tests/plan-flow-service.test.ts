import { describe, expect, it, vi } from 'vitest';

import { createPlanFlowService } from '../implementation/plan-flow-service.js';
import { createInMemoryPlanFlowRepository } from '../ports/plan-flow-repository.js';
import { createInMemoryScheduleRepository } from '../ports/schedule-repository.js';

const tx = {
  stageJson: async () => undefined,
  stageText: async () => undefined,
  deleteOnCommit: async () => undefined,
};
const unitOfWork = {
  async execute<T>(_request: unknown, work: (context: typeof tx) => Promise<T>) {
    return work(tx);
  },
};
const context = {
  commandId: 'confirm_01',
  correlationId: 'correlation_01',
  idempotencyKey: 'idem_01',
  actor: 'local-user' as const,
  requestedAt: '2026-07-13T00:00:00.000Z',
  receivedAt: '2026-07-13T00:00:00.000Z',
  expectedVersion: 2,
};

function fixture() {
  const flows = createInMemoryPlanFlowRepository();
  const schedules = createInMemoryScheduleRepository();
  let scheduleVersion = 0;
  let scheduleId = 0;
  const submit = vi.fn().mockResolvedValue({ taskId: 'task_plan_01' });
  const service = createPlanFlowService({
    repository: flows,
    scheduleRepository: schedules,
    unitOfWork,
    generationRuntime: { submit },
    getScheduleVersion: async () => scheduleVersion,
    lessonExists: async (lessonId) => ['lesson_01', 'lesson_02'].includes(lessonId),
    nextPlanFlowId: () => 'plan_flow_01',
    nextScheduleItemId: () => `schedule_${++scheduleId}`,
    now: () => new Date('2026-07-13T00:00:00.000Z'),
  });
  return {
    service,
    flows,
    schedules,
    submit,
    setScheduleVersion(value: number) {
      scheduleVersion = value;
    },
  };
}

const previewInput = {
  constraintsArtifactRef: 'artifact_constraints_01',
  courseRefs: ['course_01'],
  lessonRefs: ['lesson_01', 'lesson_02'],
  timeWindowRefs: ['window_weekday_evenings'],
  existingScheduleSnapshotRef: 'schedule_snapshot_0',
};

const suggestions = [
  {
    courseId: 'course_01',
    lessonId: 'lesson_01',
    startAt: '2026-07-14T11:00:00.000Z',
    endAt: '2026-07-14T12:00:00.000Z',
    timezoneAtCreation: 'Asia/Shanghai',
    explanation: 'First available evening',
  },
  {
    courseId: 'course_01',
    lessonId: 'lesson_02',
    startAt: '2026-07-15T11:00:00.000Z',
    endAt: '2026-07-15T12:00:00.000Z',
    timezoneAtCreation: 'Asia/Shanghai',
    explanation: 'Keeps lesson order',
  },
];

describe('PlanFlowService', () => {
  it('[EQ-PF-01] previews without changing schedule and retains constraints plus draft on AI failure', async () => {
    const { service, schedules, submit, flows } = fixture();
    const requested = await service.requestPreview(previewInput, 'preview_01');
    expect(requested).toMatchObject({
      id: 'plan_flow_01',
      state: 'previewing',
      baseScheduleVersion: 0,
      constraintsArtifactRef: 'artifact_constraints_01',
    });
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        inputSnapshotHash: expect.any(String),
        prompt: expect.stringContaining('schedule_snapshot_0'),
      }),
    );
    expect(JSON.stringify(submit.mock.calls)).not.toContain('rawConversation');
    const currentItems = [];
    for await (const item of schedules.list()) currentItems.push(item);
    expect(currentItems).toEqual([]);

    await service.fail(requested.id, 'provider_timeout', 'draft_plan_01');
    await expect(flows.get(requested.id)).resolves.toMatchObject({
      state: 'failed',
      constraintsArtifactRef: 'artifact_constraints_01',
      draftArtifactRef: 'draft_plan_01',
    });
  });

  it('validates preview lessons, intervals, and duplicate suggestions', async () => {
    const { service } = fixture();
    const requested = await service.requestPreview(previewInput, 'preview_01');
    await expect(
      service.markPreviewReady(requested.id, [{ ...suggestions[0]!, lessonId: 'unknown_lesson' }]),
    ).rejects.toMatchObject({ code: 'plan_preview_invalid' });
    await expect(
      service.markPreviewReady(requested.id, [suggestions[0]!, suggestions[0]!]),
    ).rejects.toMatchObject({ code: 'plan_preview_invalid' });
  });

  it('rejects a stale base schedule and confirms every suggestion exactly once', async () => {
    const { service, schedules, setScheduleVersion } = fixture();
    const requested = await service.requestPreview(previewInput, 'preview_01');
    const ready = await service.markPreviewReady(requested.id, suggestions);
    setScheduleVersion(1);
    await expect(
      service.confirm(ready.id, { ...context, expectedVersion: ready.resourceVersion }),
    ).rejects.toMatchObject({ code: 'version_conflict', currentVersion: 1 });

    setScheduleVersion(0);
    const confirmed = await service.confirm(ready.id, {
      ...context,
      expectedVersion: ready.resourceVersion,
    });
    expect(confirmed).toMatchObject({
      state: 'confirmed',
      confirmedScheduleItemIds: ['schedule_1', 'schedule_2'],
    });
    const repeated = await service.confirm(ready.id, {
      ...context,
      expectedVersion: confirmed.resourceVersion,
    });
    expect(repeated).toEqual(confirmed);
    const items = [];
    for await (const item of schedules.list()) items.push(item.id);
    expect(items).toEqual(['schedule_1', 'schedule_2']);
  });
});
