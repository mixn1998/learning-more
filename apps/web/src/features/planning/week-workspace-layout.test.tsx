// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { ScheduleItemView } from '../../client/planning-client.js';
import { WeeklyReportWorkspace } from '../history/weekly-report-workspace.js';
import { PlanningWorkspaceView } from './planning-workspace-view.js';

afterEach(cleanup);

describe('shared week workspace presentation', () => {
  it('renders multiple scheduled lessons as separate rows in the planning week rail', () => {
    const items: readonly ScheduleItemView[] = [
      {
        id: 'schedule_01',
        courseId: 'course_01',
        lessonId: 'lesson_01',
        startAt: '2026-07-17T11:00:00.000Z',
        endAt: '2026-07-17T11:45:00.000Z',
        timezoneAtCreation: 'Asia/Shanghai',
        source: 'manual',
        status: 'scheduled',
        locked: false,
        createdAt: '2026-07-15T00:00:00.000Z',
        updatedAt: '2026-07-15T00:00:00.000Z',
        processedCommandIds: [],
        resourceVersion: 1,
      },
      {
        id: 'schedule_02',
        courseId: 'course_02',
        lessonId: 'lesson_02',
        startAt: '2026-07-17T12:00:00.000Z',
        endAt: '2026-07-17T12:45:00.000Z',
        timezoneAtCreation: 'Asia/Shanghai',
        source: 'manual',
        status: 'scheduled',
        locked: false,
        createdAt: '2026-07-15T00:00:00.000Z',
        updatedAt: '2026-07-15T00:00:00.000Z',
        processedCommandIds: [],
        resourceVersion: 1,
      },
    ];

    render(
      <PlanningWorkspaceView
        anchorDate="2026-07-15"
        courses={[
          {
            courseId: 'course_01',
            title: '商业课程',
            status: 'active',
            courseMode: 'standard',
            outlineVersionId: 'outline_01',
            resourceVersion: 1,
          },
          {
            courseId: 'course_02',
            title: '数学课程',
            status: 'active',
            courseMode: 'standard',
            outlineVersionId: 'outline_02',
            resourceVersion: 1,
          },
        ]}
        items={items}
        lessons={[
          {
            courseId: 'course_01',
            lessonId: 'lesson_01',
            title: '验证首批付费客户',
            progress: 'not_started',
            recommended: false,
          },
          {
            courseId: 'course_02',
            lessonId: 'lesson_02',
            title: '函数与映射关系',
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

    const day = screen.getByRole('button', {
      name: /验证首批付费客户.*函数与映射关系/u,
    });
    expect(within(day).getAllByRole('listitem')).toHaveLength(2);
  });

  it('uses the same row-based week rail in the weekly report', () => {
    render(
      <WeeklyReportWorkspace
        activeDayCount={1}
        actualSeconds={1800}
        completedLessonCount={2}
        endLocalDate="2026-07-19"
        onBack={() => undefined}
        onOpenRecord={() => undefined}
        records={[
          {
            localDate: '2026-07-17',
            lessonId: 'lesson_01',
            title: '验证首批付费客户',
            domain: '商业',
            topic: '市场验证',
          },
          {
            localDate: '2026-07-17',
            lessonId: 'lesson_02',
            title: '函数与映射关系',
            domain: '数学',
            topic: '函数',
          },
        ]}
        reportState="missing"
        startLocalDate="2026-07-13"
      />,
    );

    const day = screen.getByRole('button', {
      name: /验证首批付费客户.*函数与映射关系/u,
    });
    expect(within(day).getAllByRole('listitem')).toHaveLength(2);
  });
});
