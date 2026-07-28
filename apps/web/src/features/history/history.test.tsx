// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import type { HistoryClient } from '../../client/history-client.js';
import { HistoryPage, weeklyReportRefreshDelay } from './history-page.js';

afterEach(cleanup);

function renderHistory(api: HistoryClient, initialEntry = '/') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <HistoryPage client={api} />
    </MemoryRouter>,
  );
}

function client(): HistoryClient {
  return {
    getCatalog: vi.fn().mockResolvedValue({
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
      daily: [
        {
          localDate: '2026-07-03',
          actualSeconds: 600,
          completedLessonCount: 1,
          closedCourseIds: ['course_01'],
          abandonedCourseIds: [],
          interactionPromptedCount: 0,
          interactionRespondedCount: 0,
          interactionSkippedCount: 0,
          actualSecondsByCourse: { course_01: 600 },
        },
        {
          localDate: '2026-07-05',
          actualSeconds: 120,
          completedLessonCount: 1,
          closedCourseIds: [],
          abandonedCourseIds: [],
          interactionPromptedCount: 0,
          interactionRespondedCount: 0,
          interactionSkippedCount: 0,
          actualSecondsByCourse: { course_01: 120 },
        },
      ],
      courseRollups: [
        {
          courseId: 'course_01',
          actualSeconds: 720,
          completedLessonCount: 2,
          abandonedLessonCount: 0,
          latestActivityDate: '2026-07-05',
        },
      ],
      asOfEventId: 'event_f2',
      projectionVersion: 1,
      freshness: 'stale',
    }),
    getCalendar: vi.fn().mockResolvedValue({
      days: [
        {
          localDate: '2026-07-03',
          actualSeconds: 600,
          completedLessonIds: ['lesson_01'],
          completions: [{ lessonId: 'lesson_01', courseId: 'course_01', actualSeconds: 600 }],
        },
        { localDate: '2026-07-05', actualSeconds: 0, completedLessonIds: [], completions: [] },
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
    retryWeeklyReport: vi.fn(),
  };
}

describe('HistoryPage', () => {
  it('keeps polling missing, generating, and failed weekly reports until finalized', () => {
    expect(weeklyReportRefreshDelay(undefined)).toBe(5_000);
    expect(weeklyReportRefreshDelay({ state: 'generating' } as never)).toBe(5_000);
    expect(weeklyReportRefreshDelay({ state: 'failed' } as never)).toBe(30_000);
    expect(weeklyReportRefreshDelay({ state: 'finalized' } as never)).toBeUndefined();
  });

  it('retries a failed weekly report from the circular control and shows generation progress', async () => {
    const api = client();
    const failedReport = {
      localWeekKey: '2026-W30',
      timezone: 'Asia/Shanghai',
      startLocalDate: '2026-07-20',
      endLocalDate: '2026-07-27',
      state: 'failed' as const,
      factSnapshot: [],
      factSnapshotHash: 'snapshot_hash',
      snapshotExclusions: [],
      metricDefinitionVersion: 4,
      generationTaskId: 'task_failed',
      attemptCount: 1,
      nextRetryAt: '2026-07-27T03:05:00.000Z',
      errorCode: 'provider_timeout',
      draftArtifactRef: 'draft_task_failed',
      createdAt: '2026-07-27T02:00:00.000Z',
      updatedAt: '2026-07-27T03:00:00.000Z',
      resourceVersion: 3,
    };
    api.getWeeklyReport = vi.fn().mockResolvedValue(failedReport);
    api.retryWeeklyReport = vi.fn().mockResolvedValue({
      ...failedReport,
      state: 'generating',
      generationTaskId: 'task_retry',
      attemptCount: 2,
      nextRetryAt: undefined,
      errorCode: undefined,
      draftArtifactRef: undefined,
      updatedAt: '2026-07-27T03:01:00.000Z',
      resourceVersion: 4,
    });

    renderHistory(api, '/history?tab=weekly');

    await screen.findByRole('heading', { name: '上周学习回顾' });
    fireEvent.click(screen.getByRole('button', { name: /上周学习报告/u }));
    fireEvent.click(screen.getByRole('button', { name: '重新生成上周学习报告' }));

    await waitFor(() => expect(api.retryWeeklyReport).toHaveBeenCalledWith('2026-W30', 3));
    expect(await screen.findByRole('status')).toHaveTextContent('上周学习成果正在汇总');
  });

  it('builds the course domain filter from confirmed discipline tags', async () => {
    renderHistory(client());

    const domainFilter = await screen.findByRole('combobox', { name: '学科 / 领域' });
    expect(domainFilter).toHaveValue('');
    expect(screen.getByRole('option', { name: '商业' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: '未分类领域' })).not.toBeInTheDocument();
  });

  it('keeps the statistics workspace when the course catalog is unavailable', async () => {
    const api = client();
    vi.mocked(api.getCatalog).mockRejectedValue(new Error('catalog_unavailable'));

    renderHistory(api);

    expect(await screen.findByRole('heading', { level: 1, name: '历史统计' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '本年' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('课程目录暂不可用');
    expect(screen.queryByRole('heading', { name: '学习时间线' })).not.toBeInTheDocument();
  });

  it('[EQ-HIS-01] exposes statistics and calendar as peer tabs without a course-aggregate history entry', async () => {
    renderHistory(client());
    await screen.findByText('数据截至：event_f2');
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      '历史统计',
      '学习日历',
    ]);
    expect(screen.queryByRole('tab', { name: /课程回顾|课程聚合/ })).not.toBeInTheDocument();
  });

  it('renders statistics as soon as core metrics arrive while details continue in background', async () => {
    const api = client();
    vi.mocked(api.getCatalog).mockReturnValue(new Promise(() => undefined));
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

  it('uses aggregate statistics without loading every history cursor page', async () => {
    const api = client();
    renderHistory(api);
    await screen.findByText('历史课程');
    await waitFor(() => expect(api.getHistory).not.toHaveBeenCalled());
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
      endLocalDate: '2026-07-06',
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
    expect(screen.queryByText(/冻结证据/u)).not.toBeInTheDocument();
    expect(screen.queryByText('10 min')).not.toBeInTheDocument();
    expect(screen.queryByText('1667 min')).not.toBeInTheDocument();
    expect(screen.getByText('已建立可追溯的判断标准。')).toBeVisible();
    expect(screen.queryByText('继续验证反馈是否改变行动。')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /lesson_01 商业/ })).toBeVisible();
  });
});
