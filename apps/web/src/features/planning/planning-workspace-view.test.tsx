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
    onClearAll?: WorkspaceProps['onClearAll'];
    onCreate?: WorkspaceProps['onCreate'];
    onMove?: WorkspaceProps['onMove'];
  } = {},
) {
  const onCreate =
    overrides.onCreate ?? vi.fn<WorkspaceProps['onCreate']>().mockResolvedValue(undefined);
  const onMove = overrides.onMove ?? vi.fn<WorkspaceProps['onMove']>().mockResolvedValue(undefined);
  const onClearAll =
    overrides.onClearAll ?? vi.fn<WorkspaceProps['onClearAll']>().mockResolvedValue(undefined);
  render(
    <PlanningWorkspaceView
      anchorDate="2026-07-15"
      courses={courses}
      items={[todayItem]}
      lessons={lessons}
      onClearAll={onClearAll}
      onCreate={onCreate}
      onGeneratePlanFlow={() => undefined}
      onMove={onMove}
      onRemove={async () => undefined}
      onReturn={() => undefined}
    />,
  );
  return { onClearAll, onCreate, onMove };
}

describe('PlanningWorkspaceView date scheduling', () => {
  it('clears all active schedules from one explicit planning action', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onClearAll = vi.fn<WorkspaceProps['onClearAll']>().mockResolvedValue(undefined);
    renderWorkspace({ onClearAll });

    fireEvent.click(screen.getByRole('button', { name: '清空排期' }));

    await waitFor(() => expect(onClearAll).toHaveBeenCalledOnce());
    expect(confirm).toHaveBeenCalledWith('确定清空当前全部排期吗？已完成的学习事实不会被删除。');
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
        onClearAll={async () => undefined}
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
