// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';

import type { HistoryClient } from '../../client/history-client.js';
import type { ProfileClient } from '../../client/profile-client.js';
import { HistoryPage } from './history-page.js';

afterEach(cleanup);

function renderHistory(api: HistoryClient, initialEntry = '/') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <HistoryPage client={api} />
    </MemoryRouter>,
  );
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="current-path">{location.pathname + location.search}</output>;
}

function portraitClient(): ProfileClient {
  return {
    getProfile: vi.fn().mockResolvedValue({ profileSchemaVersion: 1 }),
    getEvidence: vi.fn().mockResolvedValue([]),
    getPortrait: vi.fn().mockResolvedValue(undefined),
    getPortraitVersion: vi.fn().mockResolvedValue(undefined),
    refresh: vi.fn(),
  };
}

function client(): HistoryClient {
  return {
    getDashboard: vi.fn().mockResolvedValue({
      generatedAt: '2026-07-14T00:00:00.000Z',
      draftSessions: [],
      courses: [
        {
          courseId: 'course_01',
          title: '测试课程',
          status: 'active',
          courseMode: 'standard',
          outlineVersionId: 'outline_01',
          disciplineTag: 'AI 商业分析与创业',
          resourceVersion: 1,
        },
      ],
      lessons: [
        {
          courseId: 'course_01',
          lessonId: 'lesson_01',
          title: 'lesson_01',
          progress: 'completed',
          recommended: false,
        },
        {
          courseId: 'course_01',
          lessonId: 'lesson_03',
          title: 'lesson_03',
          progress: 'completed',
          recommended: false,
        },
      ],
      schedule: [],
    }),
    getCourseSummary: vi.fn().mockResolvedValue({
      courses: [],
      projectionVersion: 1,
      freshness: 'current',
    }),
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
                payload: { actualSeconds: 600 },
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
                payload: { actualSeconds: 120 },
              },
            ],
            asOfEventId: 'event_f3',
            projectionVersion: 1,
            freshness: 'current' as const,
          },
    ),
    getStatistics: vi.fn().mockResolvedValue({
      totalActualSeconds: 600,
      validSessionCount: 1,
      lessonCompletedCount: 1,
      lessonAbandonedCount: 0,
      lessonRestoredCount: 0,
      courseClosedCount: 1,
      activeDayCount: 1,
      currentStreakDays: 1,
      longestStreakDays: 1,
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
  it('builds the course domain filter from confirmed discipline tags', async () => {
    renderHistory(client());

    const domainFilter = await screen.findByRole('combobox', { name: '学科 / 领域' });
    expect(domainFilter).toHaveValue('');
    expect(screen.getByRole('option', { name: '商业' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: '未分类领域' })).not.toBeInTheDocument();
  });

  it('keeps the statistics workspace when the course catalog is unavailable', async () => {
    const api = client();
    vi.mocked(api.getDashboard).mockRejectedValue(new Error('catalog_unavailable'));

    renderHistory(api);

    expect(await screen.findByRole('heading', { level: 1, name: '历史统计' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '本年' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('课程目录暂不可用');
    expect(screen.queryByRole('heading', { name: '学习时间线' })).not.toBeInTheDocument();
  });

  it('[EQ-HIS-01] exposes statistics, calendar, and portrait as three peer tabs without a course-aggregate history entry', async () => {
    renderHistory(client());
    await screen.findByText('数据截至：event_f2');
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      '历史统计',
      '学习日历',
      '学习画像',
    ]);
    expect(screen.queryByRole('tab', { name: /课程回顾|课程聚合/ })).not.toBeInTheDocument();
  });

  it('keeps learning portrait inside the history tab and never opens the global profile route', async () => {
    render(
      <MemoryRouter initialEntries={['/history']}>
        <HistoryPage client={client()} portraitClient={portraitClient()} />
        <LocationProbe />
      </MemoryRouter>,
    );

    await screen.findByRole('heading', { name: '历史统计' });
    fireEvent.click(screen.getByRole('tab', { name: '学习画像' }));

    expect(await screen.findByRole('heading', { name: '学习画像' })).toBeVisible();
    expect(screen.getByTestId('current-path')).toHaveTextContent('/history?tab=portrait');
    expect(screen.queryByText('全局学习档案')).not.toBeInTheDocument();
    expect(screen.getByText('LEARNING PORTRAIT')).toBeVisible();
    expect(document.querySelector('.portrait-workspace')).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(3);

    fireEvent.click(screen.getByRole('tab', { name: '学习日历' }));
    expect(await screen.findByRole('heading', { level: 1, name: '学习日历' })).toBeVisible();
    expect(screen.getByTestId('current-path')).toHaveTextContent('/history?tab=calendar');

    fireEvent.click(screen.getByRole('tab', { name: '历史统计' }));
    expect(await screen.findByRole('heading', { level: 1, name: '历史统计' })).toBeVisible();
    expect(screen.getByTestId('current-path')).toHaveTextContent('/history');
  });

  it('opens the portrait snapshot without loading unrelated history projections', async () => {
    const historyApi = client();
    const portraitApi = portraitClient();
    render(
      <MemoryRouter initialEntries={['/history?tab=portrait']}>
        <HistoryPage client={historyApi} portraitClient={portraitApi} />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: '学习画像' })).toBeVisible();
    expect(historyApi.getDashboard).not.toHaveBeenCalled();
    expect(historyApi.getHistory).not.toHaveBeenCalled();
    expect(historyApi.getStatistics).not.toHaveBeenCalled();
    expect(historyApi.getCalendar).not.toHaveBeenCalled();
    expect(historyApi.getWeeklyReport).not.toHaveBeenCalled();
  });

  it('renders statistics as soon as core metrics arrive while details continue in background', async () => {
    const api = client();
    vi.mocked(api.getDashboard).mockReturnValue(new Promise(() => undefined));
    vi.mocked(api.getHistory).mockReturnValue(new Promise(() => undefined));

    renderHistory(api);

    expect(await screen.findByRole('heading', { level: 1, name: '历史统计' })).toBeVisible();
    expect(screen.getByText('0.2 小时')).toBeVisible();
    expect(api.getStatistics).toHaveBeenCalledTimes(1);
    expect(api.getWeeklyReport).not.toHaveBeenCalled();
  });

  it('[EQ-HIS-05] shows stale/asOf context and switches dates without retaining old results', async () => {
    renderHistory(client());
    expect(screen.getByText('正在加载历史')).toBeInTheDocument();
    expect(await screen.findByRole('status')).toHaveTextContent('stale');
    expect(screen.getByText('数据截至：event_f2')).toBeInTheDocument();
    expect(screen.getByText('0.2 小时')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: '学习日历' }));
    fireEvent.click(await screen.findByRole('button', { name: /2026-07-03/ }));
    expect(screen.getByRole('button', { name: /lesson_01/ })).toBeInTheDocument();
    expect(screen.queryByText(/course_01/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /2026-07-05/ }));
    expect(screen.getByText('当天暂无已归档课节')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /lesson_01/ })).not.toBeInTheDocument();
  });

  it('[EQ-CAL-02] opens the course and authoritative Review from a completed calendar entry', async () => {
    renderHistory(client());
    await screen.findByText('数据截至：event_f2');
    fireEvent.click(screen.getByRole('tab', { name: '学习日历' }));
    fireEvent.click(await screen.findByRole('button', { name: /2026-07-03/ }));

    expect(screen.getByRole('link', { name: '打开课程' })).toHaveAttribute(
      'href',
      '/courses/course_01',
    );
    expect(screen.getByRole('link', { name: '打开 Review' })).toHaveAttribute(
      'href',
      '/courses/course_01/lessons/lesson_01/record?tab=review',
    );
  });

  it('loads every cursor page into the real analytics model', async () => {
    const api = client();
    renderHistory(api);
    await screen.findByText('历史课程');
    await waitFor(() => expect(api.getHistory).toHaveBeenCalledWith('cursor_1'));
    expect(screen.getByText(/lesson_01 \/ lesson_03/)).toBeInTheDocument();
    expect(screen.getByText('12m')).toBeInTheDocument();
  });

  it('renders the finalized weekly report from frozen facts and keeps AI prose collapsed by default', async () => {
    const api = client();
    api.getWeekly = vi.fn().mockResolvedValue({
      week: {
        isoWeek: '2026-W27',
        timezone: 'Asia/Shanghai',
        actualSeconds: 99_999,
        completedLessonCount: 99,
        activeDayCount: 7,
      },
      projectionVersion: 1,
      freshness: 'current',
    });
    api.getWeeklyReport = vi.fn().mockResolvedValue({
      localWeekKey: '2026-W27',
      timezone: 'Asia/Shanghai',
      startLocalDate: '2026-06-29',
      endLocalDate: '2026-07-05',
      state: 'finalized',
      factSnapshot: [
        {
          factId: 'weekly_fact_1',
          occurredAt: '2026-07-02T08:00:00.000Z',
          courseId: 'course_01',
          lessonId: 'lesson_01',
          summary: 'LessonCompletedFact',
          actualSeconds: 600,
          topicTags: ['反馈'],
        },
      ],
      factSnapshotHash: 'snapshot_hash',
      metricDefinitionVersion: 1,
      generationTaskId: 'weekly_task_1',
      artifactRef: 'weekly_report_2026-W27',
      contentSha256: 'content_hash',
      markdown: '# AI 总结\n已建立可追溯的判断标准。\n\n## 下周建议\n继续验证反馈是否改变行动。',
      createdAt: '2026-07-06T00:00:00.000Z',
      updatedAt: '2026-07-06T00:01:00.000Z',
      resourceVersion: 1,
    });

    renderHistory(api, '/history?tab=weekly');

    expect(await screen.findByRole('heading', { name: '上周学习回顾' })).toBeVisible();
    expect(screen.getByText(/2026\/06\/29 — 07\/05/)).toBeVisible();
    const toggle = screen.getByRole('button', { name: /上周学习报告/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('已建立可追溯的判断标准。')).not.toBeVisible();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('冻结证据 1 条 · 本周窗口内来源已核验')).toBeVisible();
    expect(screen.getByText('10 min')).toBeVisible();
    expect(screen.queryByText('1667 min')).not.toBeInTheDocument();
    expect(screen.getByText('已建立可追溯的判断标准。')).toBeVisible();
    expect(screen.getByText('继续验证反馈是否改变行动。')).toBeVisible();
    expect(screen.getByRole('button', { name: /lesson_01 商业/ })).toBeVisible();
  });
});
