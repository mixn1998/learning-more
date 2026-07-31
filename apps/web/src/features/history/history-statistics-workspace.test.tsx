// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  HistoryStatisticsWorkspace,
  type HistoryStatisticsSnapshot,
} from './history-statistics-workspace.js';

afterEach(cleanup);

const snapshot: HistoryStatisticsSnapshot = {
  hours: '12.0 小时',
  completedLessons: 12,
  closedCourses: 1,
  activeDays: 6,
  courseCount: 3,
  abandonedCourseCount: 0,
  currentStreakDays: 2,
  longestStreakDays: 4,
  weeklyTrend: Array.from({ length: 12 }, (_, index) => ({
    startDate: `06/${String(index + 1).padStart(2, '0')}`,
    endDate: `06/${String(index + 7).padStart(2, '0')}`,
    durationMinutes: index === 11 ? 135 : 0,
    lessonCount: index === 11 ? 3 : 0,
    height: index === 11 ? 94 : 0,
  })),
  disciplines: Array.from({ length: 10 }, (_, index) => ({
    label: `学科 ${index + 1}`,
    percent: 86 - index * 5,
    hours: `${10 - index}.0h`,
  })),
  interactionResponseRate: 0,
  interactionSkipped: 0,
};

describe('HistoryStatisticsWorkspace disciplines', () => {
  it('shows the leading disciplines first and expands the full sorted list in place', () => {
    render(
      <HistoryStatisticsWorkspace
        courses={[]}
        getSnapshot={() => snapshot}
        onOpenCourse={vi.fn()}
        onSectionChange={vi.fn()}
      />,
    );

    expect(screen.getByText('学科 8')).toBeInTheDocument();
    expect(screen.queryByText('学科 9')).not.toBeInTheDocument();

    const expand = screen.getByRole('button', { name: '查看全部 10 个学科' });
    expect(expand).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(expand);

    expect(screen.getByText('学科 9')).toBeInTheDocument();
    expect(screen.getByText('学科 10')).toBeInTheDocument();
    const collapse = screen.getByRole('button', { name: '收起' });
    expect(collapse).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(collapse);
    expect(screen.queryByText('学科 9')).not.toBeInTheDocument();
  });
});

describe('HistoryStatisticsWorkspace weekly trend', () => {
  it('shows exact duration and distinct course count on hover or click', () => {
    render(
      <HistoryStatisticsWorkspace
        courses={[]}
        getSnapshot={() => snapshot}
        onOpenCourse={vi.fn()}
        onSectionChange={vi.fn()}
      />,
    );

    const week = screen.getByRole('button', { name: /第 12 周.*学习 2 小时 15 分钟.*3 节课/ });
    fireEvent.mouseEnter(week);
    expect(screen.getByRole('tooltip')).toHaveTextContent('学习时长：2 小时 15 分钟');
    expect(screen.getByRole('tooltip')).toHaveTextContent('课节数量：3 节');
    fireEvent.mouseLeave(week);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    fireEvent.click(week);
    expect(week).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('tooltip')).toHaveTextContent('课节数量：3 节');
  });
});

describe('HistoryStatisticsWorkspace course filters', () => {
  it('groups the filters and marks a custom-menu selection as active', () => {
    render(
      <HistoryStatisticsWorkspace
        courses={[]}
        getSnapshot={() => snapshot}
        onOpenCourse={vi.fn()}
        onSectionChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('group', { name: '历史课程筛选' })).toBeVisible();

    const statusSelect = screen.getByRole('combobox', { name: '课程状态' });
    const statusField = statusSelect.closest('[data-active]');
    expect(statusField).toHaveAttribute('data-active', 'false');

    fireEvent.click(statusSelect);
    expect(statusSelect).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('listbox', { name: '课程状态选项' })).toBeVisible();
    fireEvent.click(screen.getByRole('option', { name: '学习中' }));

    expect(statusField).toHaveAttribute('data-active', 'true');
    expect(statusSelect).toHaveTextContent('学习中');
    expect(statusSelect).toHaveAttribute('aria-expanded', 'false');
  });

  it('supports keyboard selection and dismissal', () => {
    render(
      <HistoryStatisticsWorkspace
        courses={[]}
        getSnapshot={() => snapshot}
        onOpenCourse={vi.fn()}
        onSectionChange={vi.fn()}
      />,
    );

    const sortSelect = screen.getByRole('combobox', { name: '排序' });
    fireEvent.keyDown(sortSelect, { key: 'ArrowDown' });
    expect(sortSelect).toHaveAttribute('aria-expanded', 'true');

    fireEvent.keyDown(sortSelect, { key: 'ArrowDown' });
    fireEvent.keyDown(sortSelect, { key: 'Enter' });
    expect(sortSelect).toHaveTextContent('最早完成');

    fireEvent.click(sortSelect);
    fireEvent.keyDown(sortSelect, { key: 'Escape' });
    expect(sortSelect).toHaveAttribute('aria-expanded', 'false');
  });
});
