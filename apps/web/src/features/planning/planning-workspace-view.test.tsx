// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ScheduleItemView } from '../../client/planning-client.js';
import { PlanningWorkspaceView } from './planning-workspace-view.js';

afterEach(cleanup);

const courses = [
  {
    courseId: 'course_01',
    title: '规划课程',
    status: 'active' as const,
    courseMode: 'standard' as const,
    outlineVersionId: 'outline_01',
    resourceVersion: 1,
  },
];

const lessons = [
  {
    courseId: 'course_01',
    lessonId: 'lesson_unscheduled',
    title: '未排期课节',
    objective: '识别首批付费客户并验证其购买动机。',
    coreKnowledgePoints: ['早期采用者画像', '付费触发条件'],
    estimatedMinutes: 35,
    progress: 'not_started' as const,
    recommended: true,
  },
  {
    courseId: 'course_01',
    lessonId: 'lesson_today',
    title: '今日课节',
    progress: 'not_started' as const,
    recommended: false,
  },
];

const todayItem: ScheduleItemView = {
  id: 'schedule_01',
  courseId: 'course_01',
  lessonId: 'lesson_today',
  startAt: '2026-07-15T11:00:00.000Z',
  endAt: '2026-07-15T11:45:00.000Z',
  timezoneAtCreation: 'Asia/Shanghai',
  source: 'manual',
  status: 'scheduled',
  locked: false,
  createdAt: '2026-07-15T00:00:00.000Z',
  updatedAt: '2026-07-15T00:00:00.000Z',
  processedCommandIds: [],
  resourceVersion: 1,
};

type WorkspaceProps = ComponentProps<typeof PlanningWorkspaceView>;

function renderWorkspace(
  overrides: {
    onClear?: WorkspaceProps['onClear'];
    onCreate?: WorkspaceProps['onCreate'];
    onMove?: WorkspaceProps['onMove'];
  } = {},
) {
  const onCreate =
    overrides.onCreate ?? vi.fn<WorkspaceProps['onCreate']>().mockResolvedValue(undefined);
  const onMove = overrides.onMove ?? vi.fn<WorkspaceProps['onMove']>().mockResolvedValue(undefined);
  const onClear =
    overrides.onClear ?? vi.fn<WorkspaceProps['onClear']>().mockResolvedValue(undefined);
  render(
    <PlanningWorkspaceView
      anchorDate="2026-07-15"
      courses={courses}
      items={[todayItem]}
      lessons={lessons}
      onClear={onClear}
      onCreate={onCreate}
      onGeneratePlanFlow={() => undefined}
      onMove={onMove}
      onRemove={async () => undefined}
      onReturn={() => undefined}
    />,
  );
  return { onClear, onCreate, onMove };
}

describe('PlanningWorkspaceView date scheduling', () => {
  it('keeps the current filters after scheduling one lesson', async () => {
    const onCreate = vi.fn<WorkspaceProps['onCreate']>().mockResolvedValue(undefined);
    render(
      <PlanningWorkspaceView
        anchorDate="2026-07-15"
        courses={[{ ...courses[0]!, title: '数据结构', disciplineTag: '计算机科学' }]}
        items={[]}
        lessons={lessons}
        onClear={async () => undefined}
        onCreate={onCreate}
        onGeneratePlanFlow={() => undefined}
        onMove={async () => undefined}
        onRemove={async () => undefined}
        onReturn={() => undefined}
      />,
    );

    const titleFilter = screen.getByLabelText('课程标题');
    const statusFilter = screen.getByLabelText('排期状态');
    const disciplineFilter = screen.getByLabelText('学科/领域');
    fireEvent.change(titleFilter, { target: { value: '数据结构' } });
    fireEvent.change(statusFilter, { target: { value: '待规划' } });
    fireEvent.change(disciplineFilter, { target: { value: '计算机科学' } });

    fireEvent.change(screen.getByLabelText('安排学习日期：未排期课节'), {
      target: { value: '2026-07-16' },
    });

    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(titleFilter).toHaveValue('数据结构');
    expect(statusFilter).toHaveValue('待规划');
    expect(disciplineFilter).toHaveValue('计算机科学');
  });

  it('filters lessons by course title without matching lesson titles', () => {
    render(
      <PlanningWorkspaceView
        anchorDate="2026-07-15"
        courses={[
          { ...courses[0]!, title: '线性代数' },
          {
            courseId: 'course_02',
            title: '数据结构',
            status: 'active',
            courseMode: 'standard',
            outlineVersionId: 'outline_02',
            resourceVersion: 1,
          },
        ]}
        items={[]}
        lessons={[
          { ...lessons[0]!, title: '矩阵与映射' },
          {
            courseId: 'course_02',
            lessonId: 'lesson_tree',
            title: '线性表与树',
            progress: 'not_started',
            recommended: false,
          },
        ]}
        onClear={async () => undefined}
        onCreate={async () => undefined}
        onGeneratePlanFlow={() => undefined}
        onMove={async () => undefined}
        onRemove={async () => undefined}
        onReturn={() => undefined}
      />,
    );

    const titleFilter = screen.getByLabelText('课程标题');
    fireEvent.change(titleFilter, { target: { value: '线性代数' } });

    expect(screen.getByRole('heading', { name: '矩阵与映射' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: '线性表与树' })).not.toBeInTheDocument();

    fireEvent.change(titleFilter, { target: { value: '线性表' } });

    expect(screen.queryByRole('heading', { name: '矩阵与映射' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '线性表与树' })).not.toBeInTheDocument();
  });

  it('clears only the scheduled lessons in the current filtered result', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onClear = vi.fn<WorkspaceProps['onClear']>().mockResolvedValue(undefined);
    renderWorkspace({ onClear });

    fireEvent.click(screen.getByRole('button', { name: '清空当前筛选结果中的排期' }));

    await waitFor(() => expect(onClear).toHaveBeenCalledWith(['schedule_01']));
    expect(confirm).toHaveBeenCalledWith('清空当前筛选结果中的排期');
    confirm.mockRestore();
  });

  it('builds the discipline filter from confirmed course discipline tags', () => {
    render(
      <PlanningWorkspaceView
        anchorDate="2026-07-15"
        courses={[
          {
            ...courses[0]!,
            disciplineTag: 'AI 商业分析与创业',
            topicTags: ['市场验证', '商业模式'],
          },
          {
            courseId: 'course_02',
            title: '数学课程',
            status: 'active',
            courseMode: 'standard',
            outlineVersionId: 'outline_02',
            disciplineTag: '数学·单变量微积分与证明基础',
            topicTags: ['微积分'],
            resourceVersion: 1,
          },
        ]}
        items={[]}
        lessons={[
          lessons[0]!,
          {
            courseId: 'course_02',
            lessonId: 'lesson_calculus',
            title: '极限与连续',
            progress: 'not_started',
            recommended: false,
          },
        ]}
        onClear={async () => undefined}
        onCreate={async () => undefined}
        onGeneratePlanFlow={() => undefined}
        onMove={async () => undefined}
        onRemove={async () => undefined}
        onReturn={() => undefined}
      />,
    );

    const disciplineSelect = screen.getByLabelText('学科/领域');
    expect(screen.getByRole('option', { name: '商业' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '数学' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: '市场验证' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: '微积分' })).not.toBeInTheDocument();

    fireEvent.change(disciplineSelect, { target: { value: '数学' } });

    expect(screen.getByRole('heading', { name: '极限与连续' })).toBeVisible();
    expect(screen.queryByText('未排期课节')).not.toBeInTheDocument();
  });

  it('starts without a selected day and saves an unscheduled lesson from its inline calendar', async () => {
    const { onCreate } = renderWorkspace();

    expect(screen.getByText('未排期课节')).toBeVisible();
    expect(screen.getByRole('heading', { name: '今日课节' })).toBeVisible();
    expect(
      screen
        .getAllByRole('button')
        .filter((button) => button.getAttribute('aria-pressed') === 'true'),
    ).toHaveLength(0);

    fireEvent.change(screen.getByLabelText('安排学习日期：未排期课节'), {
      target: { value: '2026-07-16' },
    });

    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          courseId: 'course_01',
          lessonId: 'lesson_unscheduled',
          startAt: '2026-07-16T11:00:00.000Z',
          endAt: '2026-07-16T11:35:00.000Z',
        }),
      ),
    );
    expect(screen.queryByRole('dialog', { name: /学习日期/u })).not.toBeInTheDocument();
  });

  it('restores the authoritative date and shows a row error when moving fails', async () => {
    const onMove = vi
      .fn<WorkspaceProps['onMove']>()
      .mockRejectedValue(new Error('version conflict'));
    renderWorkspace({ onMove });
    const input = screen.getByLabelText('安排学习日期：今日课节');
    expect(input).toHaveValue('2026-07-15');

    fireEvent.change(input, { target: { value: '2026-07-16' } });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '排期版本已变化或日期未保存，请刷新后重试。',
    );
    expect(input).toHaveValue('2026-07-15');
  });

  it('shows the same authoritative lesson content used by course navigation', () => {
    renderWorkspace();

    fireEvent.click(screen.getAllByRole('button', { name: '预览' })[0]!);

    expect(screen.getByRole('dialog', { name: '未排期课节' })).toBeVisible();
    expect(screen.getByText('识别首批付费客户并验证其购买动机。')).toBeVisible();
    expect(screen.getByText('早期采用者画像')).toBeVisible();
    expect(screen.getByText('付费触发条件')).toBeVisible();
    expect(screen.getByText('35 分钟')).toBeVisible();
    expect(screen.queryByText('关键判断')).not.toBeInTheDocument();
  });
});
