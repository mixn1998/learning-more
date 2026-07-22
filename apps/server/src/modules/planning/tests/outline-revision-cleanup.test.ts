import { describe, expect, it, vi } from 'vitest';

import { createOutlineRevisionCleanup } from '../implementation/outline-revision-cleanup.js';
import { createInMemoryPlanFlowRepository } from '../ports/plan-flow-repository.js';
import { createInMemoryScheduleRepository } from '../ports/schedule-repository.js';

const tx = {
  stageJson: async () => undefined,
  stageText: async () => undefined,
  deleteOnCommit: async () => undefined,
};

describe('outline revision planning cleanup', () => {
  it('retires stale active schedules and invalidates an unconfirmed flow without deleting history', async () => {
    const schedules = createInMemoryScheduleRepository();
    const planFlows = createInMemoryPlanFlowRepository();
    const recordScheduleCancelled = vi.fn();
    const seedSchedule = async (id: string, lessonId: string) =>
      schedules.save(
        tx,
        {
          id,
          courseId: 'course_01',
          lessonId,
          startAt: '2026-07-20T01:00:00.000Z',
          endAt: '2026-07-20T01:30:00.000Z',
          timezoneAtCreation: 'Asia/Shanghai',
          source: 'plan-flow',
          status: 'scheduled',
          createdAt: '2026-07-17T00:00:00.000Z',
          updatedAt: '2026-07-17T00:00:00.000Z',
          processedCommandIds: [],
          resourceVersion: 0,
        },
        0,
      );
    await seedSchedule('schedule_old', 'lesson_old');
    await seedSchedule('schedule_current', 'lesson_current');
    const retainedScheduleBeforeRevision = await schedules.get('schedule_current');
    await planFlows.save(
      tx,
      {
        id: 'flow_pending',
        state: 'preview-ready',
        constraintsArtifactRef: 'constraints_01',
        courseRefs: ['course_01'],
        lessonRefs: ['lesson_old', 'lesson_current'],
        timeWindowRefs: [],
        existingScheduleSnapshotRef: 'schedule_0',
        baseScheduleVersion: 0,
        generationTaskId: 'task_01',
        suggestions: [
          {
            courseId: 'course_01',
            lessonId: 'lesson_old',
            startAt: '2026-07-20T01:00:00.000Z',
            endAt: '2026-07-20T01:30:00.000Z',
            timezoneAtCreation: 'Asia/Shanghai',
            explanation: '旧版建议',
          },
          {
            courseId: 'course_01',
            lessonId: 'lesson_current',
            startAt: '2026-07-21T01:00:00.000Z',
            endAt: '2026-07-21T01:30:00.000Z',
            timezoneAtCreation: 'Asia/Shanghai',
            explanation: '新版建议',
          },
        ],
        conflicts: [],
        confirmationReceipts: {},
        confirmedScheduleItemIds: [],
        source: 'plan-flow',
        createdAt: '2026-07-17T00:00:00.000Z',
        updatedAt: '2026-07-17T00:00:00.000Z',
        resourceVersion: 0,
      },
      0,
    );

    const cleanup = createOutlineRevisionCleanup({
      schedules,
      planFlows,
      recordScheduleCancelled,
    });
    await cleanup.retireOutlineReferences(
      {
        courseId: 'course_01',
        retainedLessonIds: ['lesson_current'],
        knownCourseLessonIds: ['lesson_old', 'lesson_current'],
        commandId: 'outline_revision_01',
        occurredAt: '2026-07-17T01:00:00.000Z',
      },
      tx,
    );

    await expect(schedules.get('schedule_old')).resolves.toMatchObject({
      status: 'removed',
      cancelReason: 'outline_revised',
    });
    await expect(schedules.get('schedule_current')).resolves.toEqual(
      retainedScheduleBeforeRevision,
    );
    await expect(planFlows.get('flow_pending')).resolves.toMatchObject({
      state: 'failed',
      errorCode: 'outline_revised',
      lessonRefs: ['lesson_current'],
      suggestions: [{ lessonId: 'lesson_current' }],
    });
    expect(recordScheduleCancelled).toHaveBeenCalledWith(
      expect.objectContaining({
        courseId: 'course_01',
        lessonId: 'lesson_old',
        scheduleItemId: 'schedule_old',
        reason: 'outline_revised',
      }),
      tx,
    );
    expect(recordScheduleCancelled).not.toHaveBeenCalledWith(
      expect.objectContaining({ scheduleItemId: 'schedule_current' }),
      expect.anything(),
    );
  });
});
