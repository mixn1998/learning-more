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
  bars: Array.from({ length: 12 }, () => 0),
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
