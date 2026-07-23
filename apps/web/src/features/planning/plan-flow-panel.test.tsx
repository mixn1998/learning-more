// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PlanFlowPanel } from './plan-flow-panel.js';

afterEach(cleanup);

describe('PlanFlowPanel', () => {
  it('offers one-step undo only for a confirmed flow with a reversible batch', async () => {
    const course = {
      courseId: 'course_undo',
      title: '撤回测试课程',
      status: 'active' as const,
      courseMode: 'standard' as const,
      outlineVersionId: 'outline_undo',
      resourceVersion: 1,
    };
    const lesson = {
      courseId: course.courseId,
      lessonId: 'lesson_undo',
      title: '撤回测试课节',
      progress: 'not_started' as const,
      recommended: true,
    };
    const confirmed = {
      id: 'plan_flow_undo',
      state: 'confirmed' as const,
      constraintsArtifactRef: 'constraints_manual',
      courseRefs: [course.courseId],
      lessonRefs: [lesson.lessonId],
      timeWindowRefs: ['daily:45'],
      existingScheduleSnapshotRef: 'schedule_0',
      baseScheduleVersion: 0,
      generationTaskId: 'rules_undo',
      suggestions: [],
      conflicts: [],
      confirmationReceipts: {},
      confirmedScheduleItemIds: ['schedule_undo'],
      undoAvailable: true,
      source: 'plan-flow' as const,
      createdAt: '2026-07-15T00:00:00.000Z',
      updatedAt: '2026-07-15T00:00:00.000Z',
      resourceVersion: 2,
    };
    const onManage = vi.fn().mockResolvedValue({ ...confirmed, undoAvailable: false });
    const confirmUndo = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(
      <PlanFlowPanel
        courses={[course]}
        initialStartDate="2026-07-15"
        lessons={[lesson]}
        onConfirm={vi.fn()}
        onManage={onManage}
        onPreview={vi.fn().mockResolvedValue(confirmed)}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    fireEvent.click(screen.getByRole('button', { name: '生成计划预览' }));

    fireEvent.click(await screen.findByRole('button', { name: '撤回排期' }));

    expect(onManage).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'plan_flow_undo' }),
      'undo',
    );
    expect(confirmUndo).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '暂停计划流' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '恢复计划流' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重新排剩余' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '删除计划' })).not.toBeInTheDocument();
    confirmUndo.mockRestore();
  });

  it('requires a regenerated preview after the scheduling strategy changes', async () => {
    const course = {
      courseId: 'course_1',
      title: '计划测试课程',
      status: 'active' as const,
      courseMode: 'standard' as const,
      outlineVersionId: 'outline_1',
      resourceVersion: 1,
    };
    const lesson = {
      courseId: 'course_1',
      lessonId: 'lesson_1',
      title: '计划测试课节',
      progress: 'not_started' as const,
      recommended: true,
    };
    const preview = {
      id: 'plan_flow_preview',
      state: 'preview-ready' as const,
      constraintsArtifactRef: 'constraints_manual',
      courseRefs: [course.courseId],
      lessonRefs: [lesson.lessonId],
      timeWindowRefs: ['strategy:balanced'],
      existingScheduleSnapshotRef: 'schedule_0',
      baseScheduleVersion: 0,
      generationTaskId: 'rules_1',
      suggestions: [
        {
          courseId: course.courseId,
          lessonId: lesson.lessonId,
          startAt: '2026-07-15T11:00:00.000Z',
          endAt: '2026-07-15T11:45:00.000Z',
          timezoneAtCreation: 'Asia/Shanghai',
          explanation: '测试排期',
        },
      ],
      conflicts: [],
      confirmationReceipts: {},
      confirmedScheduleItemIds: [],
      source: 'plan-flow' as const,
      createdAt: '2026-07-15T00:00:00.000Z',
      updatedAt: '2026-07-15T00:00:00.000Z',
      resourceVersion: 1,
    };
    const onPreview = vi.fn().mockResolvedValue(preview);
    const onConfirm = vi.fn();
    render(
      <PlanFlowPanel
        courses={[course]}
        initialStartDate="2026-07-15"
        lessons={[lesson]}
        onConfirm={onConfirm}
        onManage={vi.fn()}
        onPreview={onPreview}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    fireEvent.click(screen.getByRole('button', { name: '生成计划预览' }));
    expect(await screen.findByRole('button', { name: '确认计划流' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: '上一步' }));
    fireEvent.click(screen.getByRole('button', { name: /专注完成/u }));
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));

    expect(screen.getByRole('button', { name: '重新生成排期' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: '确认计划流' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重新生成排期' }));
    expect(onPreview).toHaveBeenCalledTimes(2);
    expect(onPreview).toHaveBeenLastCalledWith(expect.objectContaining({ strategy: 'focus' }));
  });

  it('closes only after the confirmed schedule has been saved', async () => {
    const course = {
      courseId: 'course_confirm',
      title: 'Confirm and close course',
      status: 'active' as const,
      courseMode: 'standard' as const,
      outlineVersionId: 'outline_confirm',
      resourceVersion: 1,
    };
    const lesson = {
      courseId: course.courseId,
      lessonId: 'lesson_confirm',
      title: 'Confirm and close lesson',
      progress: 'not_started' as const,
      recommended: true,
    };
    const preview = {
      id: 'plan_flow_confirm',
      state: 'preview-ready' as const,
      constraintsArtifactRef: 'constraints_manual',
      courseRefs: [course.courseId],
      lessonRefs: [lesson.lessonId],
      timeWindowRefs: ['strategy:balanced'],
      existingScheduleSnapshotRef: 'schedule_0',
      baseScheduleVersion: 0,
      generationTaskId: 'rules_confirm',
      suggestions: [
        {
          courseId: course.courseId,
          lessonId: lesson.lessonId,
          startAt: '2026-07-15T11:00:00.000Z',
          endAt: '2026-07-15T11:45:00.000Z',
          timezoneAtCreation: 'Asia/Shanghai',
          explanation: 'Test schedule',
        },
      ],
      conflicts: [],
      confirmationReceipts: {},
      confirmedScheduleItemIds: [],
      source: 'plan-flow' as const,
      createdAt: '2026-07-15T00:00:00.000Z',
      updatedAt: '2026-07-15T00:00:00.000Z',
      resourceVersion: 1,
    };
    let finishConfirmation:
      ((value: Omit<typeof preview, 'state'> & { state: 'confirmed' }) => void) | undefined;
    const onConfirm = vi.fn(
      () =>
        new Promise<Omit<typeof preview, 'state'> & { state: 'confirmed' }>((resolve) => {
          finishConfirmation = resolve;
        }),
    );
    const onClose = vi.fn();
    render(
      <PlanFlowPanel
        courses={[course]}
        initialStartDate="2026-07-15"
        lessons={[lesson]}
        onClose={onClose}
        onConfirm={onConfirm}
        onManage={vi.fn()}
        onPreview={vi.fn().mockResolvedValue(preview)}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    fireEvent.click(screen.getByRole('button', { name: '生成计划预览' }));
    fireEvent.click(await screen.findByRole('button', { name: '确认计划流' }));

    expect(onClose).not.toHaveBeenCalled();
    finishConfirmation?.({ ...preview, state: 'confirmed' });

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it('groups the confirmation preview by week and summarizes daily lesson load', async () => {
    const courses = [
      {
        courseId: 'course_1',
        title: '微积分',
        status: 'active' as const,
        courseMode: 'standard' as const,
        outlineVersionId: 'outline_1',
        resourceVersion: 1,
      },
      {
        courseId: 'course_2',
        title: '数据结构',
        status: 'active' as const,
        courseMode: 'standard' as const,
        outlineVersionId: 'outline_2',
        resourceVersion: 1,
      },
    ];
    const lessons = [
      {
        courseId: 'course_1',
        lessonId: 'lesson_1',
        title: '极限的直觉',
        progress: 'not_started' as const,
        recommended: true,
      },
      {
        courseId: 'course_2',
        lessonId: 'lesson_2',
        title: '栈与队列',
        progress: 'not_started' as const,
        recommended: true,
      },
      {
        courseId: 'course_1',
        lessonId: 'lesson_3',
        title: '导数定义',
        progress: 'not_started' as const,
        recommended: true,
      },
      {
        courseId: 'course_2',
        lessonId: 'lesson_4',
        title: '树的层次关系',
        progress: 'not_started' as const,
        recommended: true,
      },
    ];
    const suggestions = [
      ['course_1', 'lesson_1', '2026-07-13T01:00:00.000Z', '2026-07-13T01:30:00.000Z'],
      ['course_2', 'lesson_2', '2026-07-13T02:00:00.000Z', '2026-07-13T02:20:00.000Z'],
      ['course_1', 'lesson_3', '2026-07-17T01:00:00.000Z', '2026-07-17T01:45:00.000Z'],
      ['course_2', 'lesson_4', '2026-07-20T01:00:00.000Z', '2026-07-20T02:00:00.000Z'],
    ].map(([courseId, lessonId, startAt, endAt]) => ({
      courseId: courseId!,
      lessonId: lessonId!,
      startAt: startAt!,
      endAt: endAt!,
      timezoneAtCreation: 'Asia/Shanghai',
      explanation: '测试排期',
    }));
    const onPreview = vi.fn().mockResolvedValue({
      id: 'plan_flow_preview',
      state: 'preview-ready',
      constraintsArtifactRef: 'constraints_manual',
      courseRefs: courses.map((course) => course.courseId),
      lessonRefs: lessons.map((lesson) => lesson.lessonId),
      timeWindowRefs: ['daily:45'],
      existingScheduleSnapshotRef: 'schedule_0',
      baseScheduleVersion: 0,
      generationTaskId: 'rules_1',
      suggestions,
      conflicts: [],
      confirmationReceipts: {},
      confirmedScheduleItemIds: [],
      source: 'plan-flow',
      createdAt: '2026-07-13T00:00:00.000Z',
      updatedAt: '2026-07-13T00:00:00.000Z',
      resourceVersion: 1,
    });

    render(
      <PlanFlowPanel
        courses={courses}
        initialStartDate="2026-07-13"
        lessons={lessons}
        onConfirm={vi.fn()}
        onManage={vi.fn()}
        onPreview={onPreview}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    fireEvent.click(screen.getByRole('button', { name: '生成计划预览' }));

    expect(await screen.findByRole('heading', { name: '第 1 周' })).toBeVisible();
    expect(screen.getByRole('heading', { name: '第 2 周' })).toBeVisible();
    expect(screen.getByText('07/13 — 07/17 · 2 个学习日')).toBeVisible();
    expect(screen.getByText('07/20 — 07/20 · 1 个学习日')).toBeVisible();
    expect(screen.getByText('50 分钟 · 2 节')).toBeVisible();
    expect(screen.getAllByText('微积分')).toHaveLength(2);
    expect(screen.getByText('极限的直觉')).toBeVisible();
    expect(screen.getByText('155 min')).toBeVisible();
    expect(screen.getAllByText('超过每日目标')).toHaveLength(2);
  });

  it('keeps retry available when structured constraints cannot produce a preview', async () => {
    const onPreview = vi.fn().mockResolvedValue({
      id: 'plan_flow_failed',
      state: 'failed',
      constraintsArtifactRef: 'constraints_manual',
      courseRefs: ['course_1'],
      lessonRefs: ['lesson_1'],
      timeWindowRefs: ['daily:45'],
      existingScheduleSnapshotRef: 'schedule_0',
      baseScheduleVersion: 0,
      generationTaskId: 'rules_1',
      suggestions: [],
      conflicts: [],
      confirmationReceipts: {},
      confirmedScheduleItemIds: [],
      source: 'plan-flow',
      errorCode: 'plan_preview_invalid',
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

    expect(
      await screen.findByText('当前日期、学习日或课节依赖无法形成有效排期，请调整约束后重试。'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '生成计划预览' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: '确认计划流' })).not.toBeInTheDocument();
  });
});
