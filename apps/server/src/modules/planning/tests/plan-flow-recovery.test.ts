import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { DataRoot } from '../../../persistence/data-root.js';
import {
  createLocalFilePlanFlowRepository,
  createLocalFileScheduleRepository,
} from '../../../persistence/planning-repositories.js';
import { createStorePaths, initializeStoreLayout } from '../../../persistence/paths.js';
import { recoverTransactions } from '../../../persistence/recover-transactions.js';
import { createUnitOfWork } from '../../../persistence/unit-of-work.js';
import { createPlanFlowService } from '../implementation/plan-flow-service.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('PlanFlow confirmation recovery', () => {
  it('[EQ-PF-02] recovers a crash after one aggregate apply to one flow and all schedule items', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'learning-more-plan-recovery-'));
    roots.push(directory);
    const dataRoot = DataRoot.create(directory);
    await initializeStoreLayout(createStorePaths(dataRoot));
    const flows = createLocalFilePlanFlowRepository(dataRoot);
    const schedules = createLocalFileScheduleRepository(dataRoot);
    const normalUnitOfWork = createUnitOfWork({ dataRoot });
    let scheduleId = 0;
    const dependencies = {
      repository: flows,
      scheduleRepository: schedules,
      generationRuntime: { submit: async () => ({ taskId: 'task_plan_01' }) },
      getScheduleVersion: async () => 0,
      lessonExists: async () => true,
      nextPlanFlowId: () => 'plan_flow_recovery',
      nextScheduleItemId: () => `schedule_recovery_${++scheduleId}`,
      now: () => new Date('2026-07-13T00:00:00.000Z'),
    };
    const setup = createPlanFlowService({ ...dependencies, unitOfWork: normalUnitOfWork });
    const requested = await setup.requestPreview(
      {
        constraintsArtifactRef: 'constraints_01',
        courseRefs: ['course_01'],
        lessonRefs: ['lesson_01', 'lesson_02'],
        timeWindowRefs: ['window_01'],
        existingScheduleSnapshotRef: 'snapshot_0',
      },
      'preview_01',
    );
    const ready = await setup.markPreviewReady(requested.id, [
      {
        courseId: 'course_01',
        lessonId: 'lesson_01',
        startAt: '2026-07-14T11:00:00.000Z',
        endAt: '2026-07-14T12:00:00.000Z',
        timezoneAtCreation: 'Asia/Shanghai',
        explanation: 'first',
      },
      {
        courseId: 'course_01',
        lessonId: 'lesson_02',
        startAt: '2026-07-15T11:00:00.000Z',
        endAt: '2026-07-15T12:00:00.000Z',
        timezoneAtCreation: 'Asia/Shanghai',
        explanation: 'second',
      },
    ]);

    let injected = false;
    const crashing = createPlanFlowService({
      ...dependencies,
      unitOfWork: createUnitOfWork({
        dataRoot,
        faultInjector(point) {
          if (!injected && point === 'after-apply:0') {
            injected = true;
            throw new Error('simulated process crash');
          }
        },
      }),
    });
    await expect(
      crashing.confirm(ready.id, {
        commandId: 'confirm_recovery',
        correlationId: 'correlation_recovery',
        idempotencyKey: 'idem_recovery',
        actor: 'local-user',
        requestedAt: '2026-07-13T00:01:00.000Z',
        receivedAt: '2026-07-13T00:01:00.000Z',
        expectedVersion: ready.resourceVersion,
      }),
    ).rejects.toThrow('simulated process crash');

    await recoverTransactions(dataRoot);
    const recoveredFlow = await createLocalFilePlanFlowRepository(dataRoot).get(ready.id);
    expect(recoveredFlow).toMatchObject({
      state: 'confirmed',
      confirmedScheduleItemIds: ['schedule_recovery_1', 'schedule_recovery_2'],
    });
    const recoveredItems: string[] = [];
    for await (const item of createLocalFileScheduleRepository(dataRoot).list()) {
      recoveredItems.push(item.id);
    }
    expect(recoveredItems).toEqual(['schedule_recovery_1', 'schedule_recovery_2']);

    const afterRestart = createPlanFlowService({ ...dependencies, unitOfWork: normalUnitOfWork });
    await expect(
      afterRestart.confirm(ready.id, {
        commandId: 'confirm_after_restart',
        correlationId: 'correlation_after_restart',
        idempotencyKey: 'idem_after_restart',
        actor: 'local-user',
        requestedAt: '2026-07-13T00:02:00.000Z',
        receivedAt: '2026-07-13T00:02:00.000Z',
        expectedVersion: recoveredFlow!.resourceVersion,
      }),
    ).resolves.toEqual(recoveredFlow);
  });
});
