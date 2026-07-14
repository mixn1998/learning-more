// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PlanFlowPanel } from './plan-flow-panel.js';

afterEach(cleanup);

describe('PlanFlowPanel', () => {
  it('keeps retry available when the durable preview reaches a failed state', async () => {
    const onPreview = vi.fn().mockResolvedValue({
      id: 'plan_flow_failed',
      state: 'failed',
      constraintsArtifactRef: 'constraints_manual',
      courseRefs: ['course_1'],
      lessonRefs: ['lesson_1'],
      timeWindowRefs: ['daily:45'],
      existingScheduleSnapshotRef: 'schedule_0',
      baseScheduleVersion: 0,
      generationTaskId: 'task_1',
      suggestions: [],
      conflicts: [],
      confirmationReceipts: {},
      confirmedScheduleItemIds: [],
      source: 'plan-flow',
      errorCode: 'generation_task_not_dispatchable',
      createdAt: '2026-07-15T00:00:00.000Z',
      updatedAt: '2026-07-15T00:00:00.000Z',
      resourceVersion: 1,
    });
    render(
      <PlanFlowPanel
        courses={[
          {
            courseId: 'course_1',
            title: '计划测试课程',
            status: 'active',
            courseMode: 'standard',
            outlineVersionId: 'outline_1',
            resourceVersion: 1,
          },
        ]}
        initialStartDate="2026-07-15"
        lessons={[
          {
            courseId: 'course_1',
            lessonId: 'lesson_1',
            title: '计划测试课节',
            progress: 'not_started',
            recommended: true,
          },
        ]}
        onConfirm={vi.fn()}
        onManage={vi.fn()}
        onPreview={onPreview}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    fireEvent.click(screen.getByRole('button', { name: '生成计划预览' }));

    expect(await screen.findByText('后台生成队列暂时不可用，请重试。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '生成计划预览' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: '确认计划流' })).not.toBeInTheDocument();
  });
});
