// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { PlanningDateFilter } from './planning-date-filter.js';

afterEach(cleanup);

describe('planning date filter', () => {
  it('[EQ-SCH-05] shows only the selected date and exposes unscheduled lessons under pending', () => {
    render(
      <PlanningDateFilter
        items={[
          { lessonId: 'lesson_today', plannedLocalDate: '2026-07-14' },
          { lessonId: 'lesson_tomorrow', plannedLocalDate: '2026-07-15' },
          { lessonId: 'lesson_pending' },
          { lessonId: 'lesson_abandoned', progress: 'abandoned' },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '2026-07-14' }));
    expect(screen.getByText('lesson_today')).toBeInTheDocument();
    expect(screen.queryByText('lesson_tomorrow')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '待规划' }));
    expect(screen.getByText('lesson_pending')).toBeInTheDocument();
    expect(screen.queryByText('lesson_today')).not.toBeInTheDocument();
    expect(screen.queryByText('lesson_abandoned')).not.toBeInTheDocument();
  });
});
