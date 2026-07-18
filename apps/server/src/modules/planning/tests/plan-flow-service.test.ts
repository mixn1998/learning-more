import { describe, expect, it } from 'vitest';

import {
  createPlanFlowService,
  type PlanPreviewContext,
} from '../implementation/plan-flow-service.js';
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

function fixture(existingSchedule: PlanPreviewContext['existingSchedule'] = []) {
  const flows = createInMemoryPlanFlowRepository();
  const schedules = createInMemoryScheduleRepository();
  let scheduleVersion = 0;
  let scheduleId = 0;
  let lessonsAvailable = true;
  const service = createPlanFlowService({
    repository: flows,
    scheduleRepository: schedules,
    unitOfWork,
    async assemblePreviewContext() {
      return {
        courses: [
          {
            courseId: 'course_01',
            title: 'Probability',
            lessonIds: ['lesson_01', 'lesson_02'],
          },
        ],
        lessons: [
          {
            lessonId: 'lesson_01',
            courseId: 'course_01',
            title: 'Foundations',
            objective: 'Build foundations',
            prerequisiteLessonIds: [],
            estimatedMinutes: 60,
            progress: 'not_started' as const,
          },
          {
            lessonId: 'lesson_02',
            courseId: 'course_01',
            title: 'Applications',
            objective: 'Apply foundations',
            prerequisiteLessonIds: [],
            estimatedMinutes: 60,
            progress: 'not_started' as const,
          },
        ],
        timezone: 'Asia/Shanghai',
        availability: {
          startLocalDate: '2026-07-14',
          dailyTargetMinutes: 60,
          learningDays: ['周二', '周三'],
        },
        userPreferences: {
          preserveExistingDates: true,
          rescheduleOverdue: false,
          strategy: 'balanced',
        },
        constraintsMarkdown: 'Keep the existing evening commitments.',
        existingSchedule,
        fixedCommitments: existingSchedule.filter((item) => item.locked === true),
      };
    },
    getScheduleVersion: async () => scheduleVersion,
    lessonIsPlannable: async (lessonId) =>
      lessonsAvailable && ['lesson_01', 'lesson_02'].includes(lessonId),
    getCourseLessonIds: async () => ['lesson_01', 'lesson_02'],
    nextPlanFlowId: () => 'plan_flow_01',
    nextScheduleItemId: () => `schedule_${++scheduleId}`,
    now: () => new Date('2026-07-13T00:00:00.000Z'),
  });
  return {
    service,
    flows,
    schedules,
    setScheduleVersion(value: number) {
      scheduleVersion = value;
    },
    deleteCourseArchive() {
      lessonsAvailable = false;
    },
  };
}

const previewInput = {
  constraintsArtifactRef: 'artifact_constraints_01',
  courseRefs: ['course_01'],
  lessonRefs: ['lesson_01', 'lesson_02'],
  timeWindowRefs: ['start:2026-07-14', 'daily:60', 'days:周二,周三'],
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
  it('rejects a plan-flow request that skips an earlier unfinished outline lesson', async () => {
    const { service } = fixture();

    await expect(
      service.requestPreview(
        { ...previewInput, lessonRefs: ['lesson_02'] },
        'preview_skips_outline_lesson',
      ),
    ).rejects.toMatchObject({ code: 'plan_preview_invalid' });
  });

  it('accepts an atomic lesson longer than the daily target', async () => {
    const { service } = fixture();
    const requested = await service.requestPreview(
      {
        ...previewInput,
        timeWindowRefs: ['start:2026-07-14', 'daily:45', 'days:周二,周三'],
      },
      'preview_soft_daily_target',
    );

    expect(requested).toMatchObject({ state: 'preview-ready' });
    expect(requested.suggestions).toHaveLength(2);
  });

  it('excludes already scheduled lessons when preserving existing dates', async () => {
    const { service } = fixture([
      {
        courseId: 'course_01',
        lessonId: 'lesson_01',
        startAt: '2026-07-16T11:00:00.000Z',
        endAt: '2026-07-16T12:00:00.000Z',
        timezoneAtCreation: 'Asia/Shanghai',
        status: 'scheduled',
      },
    ]);

    const requested = await service.requestPreview(
      {
        ...previewInput,
        timeWindowRefs: [...previewInput.timeWindowRefs, 'preserve:true'],
      },
      'preview_preserve_existing',
    );

    expect(requested.lessonRefs).toEqual(['lesson_02']);
    expect(requested.suggestions.map((item) => item.lessonId)).toEqual(['lesson_02']);
  });

  it('rejects late confirmation after a referenced course archive is permanently deleted', async () => {
    const { service, schedules, deleteCourseArchive } = fixture();
    const requested = await service.requestPreview(previewInput, 'preview_delete_race');
    const ready = await service.markPreviewReady(requested.id, suggestions);
    deleteCourseArchive();

    await expect(
      service.confirm(ready.id, { ...context, expectedVersion: ready.resourceVersion }),
    ).rejects.toMatchObject({ code: 'plan_preview_invalid' });
    const remaining = [];
    for await (const item of schedules.list()) remaining.push(item);
    expect(remaining).toEqual([]);
  });

  it('[EQ-PF-01] computes a deterministic preview without AI or schedule writes', async () => {
    const { service, schedules } = fixture();
    const requested = await service.requestPreview(previewInput, 'preview_01');
    expect(requested).toMatchObject({
      id: 'plan_flow_01',
      state: 'preview-ready',
      baseScheduleVersion: 0,
      constraintsArtifactRef: 'artifact_constraints_01',
      generationTaskId: expect.stringMatching(/^rules_/),
    });
    expect(requested.suggestions).toEqual([
      expect.objectContaining({
        lessonId: 'lesson_01',
        startAt: '2026-07-14T11:00:00.000Z',
        endAt: '2026-07-14T12:00:00.000Z',
      }),
      expect.objectContaining({
        lessonId: 'lesson_02',
        startAt: '2026-07-15T11:00:00.000Z',
        endAt: '2026-07-15T12:00:00.000Z',
      }),
    ]);
    const currentItems = [];
    for await (const item of schedules.list()) currentItems.push(item);
    expect(currentItems).toEqual([]);
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
    await expect(service.markPreviewReady(requested.id, [suggestions[0]!])).rejects.toMatchObject({
      code: 'plan_preview_invalid',
    });
    await expect(
      service.markPreviewReady(requested.id, [
        suggestions[0]!,
        {
          ...suggestions[1]!,
          startAt: suggestions[0]!.startAt,
          endAt: suggestions[0]!.endAt,
        },
      ]),
    ).rejects.toMatchObject({ code: 'plan_preview_invalid' });
    await expect(
      service.markPreviewReady(requested.id, [
        { ...suggestions[1]!, startAt: suggestions[0]!.startAt, endAt: suggestions[0]!.endAt },
        { ...suggestions[0]!, startAt: suggestions[1]!.startAt, endAt: suggestions[1]!.endAt },
      ]),
    ).rejects.toMatchObject({ code: 'plan_preview_invalid' });
    await expect(
      service.markPreviewReady(requested.id, [
        { ...suggestions[0]!, startAt: '2026-07-13T11:00:00.000Z' },
        suggestions[1]!,
      ]),
    ).rejects.toMatchObject({ code: 'plan_preview_invalid' });
    await expect(
      service.markPreviewReady(requested.id, [
        { ...suggestions[0]!, endAt: suggestions[0]!.startAt },
        suggestions[1]!,
      ]),
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

  it('undoes the initial confirmation as one batch and leaves history records removed', async () => {
    const { service, schedules } = fixture();
    const ready = await service.requestPreview(previewInput, 'preview_for_undo');
    const confirmed = await service.confirm(ready.id, {
      ...context,
      commandId: 'confirm_for_undo',
      expectedVersion: ready.resourceVersion,
    });

    const undone = await service.manage(confirmed.id, 'undo', {
      ...context,
      commandId: 'undo_confirm',
      expectedVersion: confirmed.resourceVersion,
    });

    expect(undone.state).toBe('preview-ready');
    expect(undone.confirmedScheduleItemIds).toEqual([]);
    expect(undone.lastScheduleMutation).toBeUndefined();
    const items = [];
    for await (const item of schedules.list()) items.push(item);
    expect(items).toHaveLength(2);
    expect(items.every((item) => item.status === 'removed')).toBe(true);
    expect(items.every((item) => item.cancelReason === 'plan_flow_undone')).toBe(true);
  });

  it('refuses to undo after a generated assignment was manually changed', async () => {
    const { service, schedules } = fixture();
    const ready = await service.requestPreview(previewInput, 'preview_for_conflict');
    const confirmed = await service.confirm(ready.id, {
      ...context,
      commandId: 'confirm_for_conflict',
      expectedVersion: ready.resourceVersion,
    });
    const generated = await schedules.get(confirmed.confirmedScheduleItemIds[0]!);
    await unitOfWork.execute({}, async (transaction) => {
      await schedules.save(
        transaction,
        { ...generated!, locked: true, resourceVersion: generated!.resourceVersion },
        generated!.resourceVersion,
      );
    });

    await expect(
      service.manage(confirmed.id, 'undo', {
        ...context,
        commandId: 'undo_conflict',
        expectedVersion: confirmed.resourceVersion,
      }),
    ).rejects.toMatchObject({ code: 'plan_flow_undo_conflict' });
  });
});
