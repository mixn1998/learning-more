// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { HistoryClient } from '../../client/history-client.js';
import { HistoryPage } from './history-page.js';

afterEach(cleanup);

function client(): HistoryClient {
  return {
    getHistory: vi.fn().mockImplementation(async (cursor?: string) =>
      cursor === undefined
        ? {
            entries: [
              {
                factId: 'f1',
                factType: 'LessonCompletedFact',
                occurredAt: '2026-07-02T16:30:00.000Z',
                subjectRefs: {
                  courseId: 'course_01',
                  lessonId: 'lesson_01',
                  reviewId: 'review_01',
                },
                payload: {},
              },
              {
                factId: 'f2',
                factType: 'CourseClosedFact',
                occurredAt: '2026-07-03T16:30:00.000Z',
                subjectRefs: { courseId: 'course_01' },
                payload: {},
              },
            ],
            nextCursor: 'cursor_1',
            asOfEventId: 'event_f2',
            projectionVersion: 1,
            freshness: 'stale' as const,
          }
        : {
            entries: [
              {
                factId: 'f3',
                factType: 'LessonCompletedFact',
                occurredAt: '2026-07-04T16:30:00.000Z',
                subjectRefs: { lessonId: 'lesson_03' },
                payload: {},
              },
            ],
            asOfEventId: 'event_f3',
            projectionVersion: 1,
            freshness: 'current' as const,
          },
    ),
    getStatistics: vi.fn().mockResolvedValue({
      totalActualSeconds: 600,
      lessonCompletedCount: 1,
      activeDayCount: 1,
      currentStreakDays: 1,
      definitions: { totalActualSeconds: 'metric.learning.actual_seconds' },
      asOfEventId: 'event_f2',
      projectionVersion: 1,
      freshness: 'current',
    }),
    getCalendar: vi.fn().mockResolvedValue({
      days: [
        { localDate: '2026-07-03', actualSeconds: 600, completedLessonIds: ['lesson_01'] },
        { localDate: '2026-07-05', actualSeconds: 0, completedLessonIds: [] },
      ],
      asOfEventId: 'event_f2',
      projectionVersion: 1,
      freshness: 'current',
    }),
    getWeekly: vi.fn().mockResolvedValue({
      week: { completedLessonCount: 1 },
      projectionVersion: 1,
      freshness: 'current',
    }),
    getWeeklyReport: vi.fn().mockResolvedValue(undefined),
  };
}

describe('HistoryPage', () => {
  it('[EQ-HIS-01] exposes statistics, calendar, and portrait as three peer tabs without a course-aggregate history entry', async () => {
    render(<HistoryPage client={client()} />);
    await screen.findByText('数据截至：event_f2');
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      '历史统计',
      '学习日历',
      '学习画像',
    ]);
    expect(screen.queryByRole('tab', { name: /课程回顾|课程聚合/ })).not.toBeInTheDocument();
  });

  it('[EQ-HIS-05] shows stale/asOf context and switches dates without retaining old results', async () => {
    render(<HistoryPage client={client()} />);
    expect(screen.getByText('正在加载历史')).toBeInTheDocument();
    expect(await screen.findByRole('status')).toHaveTextContent('stale');
    expect(screen.getByText('数据截至：event_f2')).toBeInTheDocument();
    expect(screen.getByText('600')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: '学习日历' }));
    fireEvent.click(screen.getByRole('button', { name: /2026-07-03/ }));
    expect(screen.getByText(/lesson_01/)).toBeInTheDocument();
    expect(screen.queryByText(/course_01/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /2026-07-05/ }));
    expect(screen.getByText('该日无完成课节')).toBeInTheDocument();
    expect(screen.queryByText(/lesson_01/)).not.toBeInTheDocument();
  });

  it('[EQ-CAL-02] opens the course and authoritative Review from a completed calendar entry', async () => {
    render(<HistoryPage client={client()} />);
    await screen.findByText('数据截至：event_f2');
    fireEvent.click(screen.getByRole('tab', { name: '学习日历' }));
    fireEvent.click(screen.getByRole('button', { name: /2026-07-03/ }));

    expect(screen.getByRole('link', { name: '打开课程' })).toHaveAttribute(
      'href',
      '/courses/course_01',
    );
    expect(screen.getByRole('link', { name: '打开 Review' })).toHaveAttribute(
      'href',
      '/courses/course_01/lessons/lesson_01/record?tab=review',
    );
  });

  it('appends cursor pages without replacing prior facts', async () => {
    const api = client();
    render(<HistoryPage client={api} />);
    fireEvent.click(await screen.findByRole('button', { name: '加载更多' }));
    await waitFor(() => expect(api.getHistory).toHaveBeenCalledWith('cursor_1'));
    expect(screen.getByText(/lesson_01/)).toBeInTheDocument();
    expect(screen.getByText(/lesson_03/)).toBeInTheDocument();
  });
});
