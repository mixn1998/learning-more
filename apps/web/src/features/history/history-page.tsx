import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import type {
  CalendarDay,
  CourseSummary,
  HistoryEntry,
  HomeDashboardView,
  StatisticsResponse,
  WeeklyReportResponse,
  WeeklySummary,
} from '@learning-more/contracts';
import { Badge, Button, ContentState, Page, Stack } from '@learning-more/ui';

import { historyClient, type HistoryClient } from '../../client/history-client.js';
import { toBroadDisciplineLabel } from '../../discipline-label.js';
import { profileClient, type ProfileClient } from '../../client/profile-client.js';
import { useAppShellBrandSubtitle, useAppShellHeaderStatus } from '../../state/app-shell-header.js';
import { CourseSummaryDrawer } from './course-summary-drawer.js';
import {
  HistoryCalendarWorkspace,
  type HistoryCalendarRecord,
} from './history-calendar-workspace.js';
import { HistoryFilters, type HistoryFactFilter } from './history-filters.js';
import {
  HistorySectionTabs,
  historySectionPanelAttributes,
  type HistorySection,
} from './history-section-tabs.js';
import { buildStatisticsCourses, buildStatisticsSnapshot } from './history-statistics-model.js';
import {
  HistoryStatisticsWorkspace,
  type HistoryStatisticsRange,
} from './history-statistics-workspace.js';
import { HistoryTimeline } from './history-timeline.js';
import { ProfilePage } from '../profile/profile-page.js';
import { StatisticsPanel } from './statistics-panel.js';
import { WeeklyReportView } from './weekly-report-view.js';
import { WeeklyReportWorkspace, type WeeklyReportRecord } from './weekly-report-workspace.js';

function localDate(value: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value));
  const get = (type: string) => parts.find((part) => part.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function isoWeek(localDateValue: string): string {
  const [year, month, day] = localDateValue.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - weekday);
  const isoYear = date.getUTCFullYear();
  const firstDay = new Date(Date.UTC(isoYear, 0, 1));
  const week = Math.ceil(((date.getTime() - firstDay.getTime()) / 86_400_000 + 1) / 7);
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

function isoWeekBounds(value: string): Readonly<{ start: string; end: string }> {
  const [yearValue, weekValue] = value.split('-W').map(Number) as [number, number];
  const januaryFourth = new Date(Date.UTC(yearValue, 0, 4));
  const mondayOffset = (januaryFourth.getUTCDay() || 7) - 1;
  const monday = new Date(januaryFourth.getTime() - mondayOffset * 86_400_000);
  monday.setUTCDate(monday.getUTCDate() + (weekValue - 1) * 7);
  const sunday = new Date(monday.getTime() + 6 * 86_400_000);
  return { start: monday.toISOString().slice(0, 10), end: sunday.toISOString().slice(0, 10) };
}

function weeklyReportSections(markdown: string | undefined): Readonly<{
  summary?: string;
  suggestion?: string;
}> {
  const content = markdown?.trim();
  if (content === undefined || content === '') return {};
  const lines = content.split('\n');
  const suggestionIndex = lines.findIndex((line) => /^#{1,6}\s*.*(?:下周|建议)/u.test(line));
  const clean = (value: readonly string[]) =>
    value
      .join('\n')
      .replace(/^#{1,6}\s*(?:AI\s*)?(?:总结|回顾)\s*\n?/iu, '')
      .trim();
  if (suggestionIndex < 0) return { summary: clean(lines) };
  const summary = clean(lines.slice(0, suggestionIndex));
  const suggestion = clean(lines.slice(suggestionIndex + 1));
  return {
    ...(summary === '' ? {} : { summary }),
    ...(suggestion === '' ? {} : { suggestion }),
  };
}

function errorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = String((error as { code: unknown }).code);
    if (code === 'projection_incomplete') return '读模型正在重建，请稍后重试。';
  }
  return '数据暂时不可用，请检查本地运行状态后重试。';
}

type LoadErrors = Partial<
  Record<'catalog' | 'history' | 'statistics' | 'calendar' | 'weekly', string>
>;

export function HistoryPage(props: {
  readonly client?: HistoryClient;
  readonly portraitClient?: ProfileClient;
}) {
  const api = props.client ?? historyClient;
  const portraitApi = props.portraitClient ?? profileClient;
  const location = useLocation();
  const navigate = useNavigate();
  const requestedTab = new URLSearchParams(location.search).get('tab');
  const showingWeekly = requestedTab === 'weekly';
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loadState, setLoadState] = useState<'loading' | 'ready'>('loading');
  const [errors, setErrors] = useState<LoadErrors>({});
  const [pageError, setPageError] = useState<string>();
  const [entries, setEntries] = useState<readonly HistoryEntry[]>([]);
  const [analyticsEntries, setAnalyticsEntries] = useState<readonly HistoryEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string>();
  const [statistics, setStatistics] = useState<StatisticsResponse>();
  const [dashboard, setDashboard] = useState<HomeDashboardView>();
  const [days, setDays] = useState<readonly CalendarDay[]>([]);
  const [freshness, setFreshness] = useState<'current' | 'stale' | 'rebuilding'>('current');
  const [asOf, setAsOf] = useState<string>();
  const [factFilter, setFactFilter] = useState<HistoryFactFilter>('all');
  const [weekly, setWeekly] = useState<WeeklySummary>();
  const [weeklyReport, setWeeklyReport] = useState<WeeklyReportResponse>();
  const [section, setSection] = useState<HistorySection>(
    requestedTab === 'calendar'
      ? 'calendar'
      : requestedTab === 'portrait'
        ? 'portrait'
        : 'statistics',
  );
  useAppShellBrandSubtitle(
    showingWeekly
      ? '上周学习回顾'
      : section === 'calendar'
        ? '学习日历'
        : section === 'portrait'
          ? '学习画像'
          : '历史统计',
  );
  useAppShellHeaderStatus(
    showingWeekly
      ? weeklyReport?.state === 'finalized'
        ? { tone: 'success', text: '● 周报已生成' }
        : weeklyReport?.state === 'failed'
          ? { tone: 'danger', text: '● 周报生成失败' }
          : { tone: 'warning', text: '● 周报生成中' }
      : undefined,
  );
  const [summaryDrawer, setSummaryDrawer] = useState<{
    open: boolean;
    courseId?: string;
    loading?: boolean;
    summary?: CourseSummary;
    error?: string;
  }>({ open: false });

  useEffect(() => {
    let current = true;
    const now = localDate(new Date().toISOString());
    const year = now.slice(0, 4);
    const currentWeek = isoWeek(now);
    setLoadState('loading');
    setErrors({});
    setPageError(undefined);
    const loadAllHistory = async () => {
      const first = await api.getHistory();
      const all = [...first.entries];
      const seen = new Set<string>();
      let cursor = first.nextCursor;
      while (cursor !== undefined && !seen.has(cursor)) {
        seen.add(cursor);
        const page = await api.getHistory(cursor);
        all.push(...page.entries);
        cursor = page.nextCursor;
      }
      return { first, all } as const;
    };
    const loadHistoryAndCalendars = async () => {
      const history = await loadAllHistory();
      const years = new Set([
        year,
        ...history.all.map((entry) => localDate(entry.occurredAt).slice(0, 4)),
      ]);
      const calendars = await Promise.allSettled(
        [...years]
          .sort()
          .map((calendarYear) => api.getCalendar(`${calendarYear}-01-01`, `${calendarYear}-12-31`)),
      );
      return { history, calendars } as const;
    };
    void Promise.allSettled([
      api.getDashboard(),
      loadHistoryAndCalendars(),
      api.getStatistics(),
      api.getWeekly(currentWeek),
      api.getWeeklyReport(currentWeek),
    ]).then(([home, historyBundle, stats, weeklyView, report]) => {
      if (!current) return;
      const nextErrors: LoadErrors = {};
      const statuses: Array<'current' | 'stale' | 'rebuilding'> = [];
      if (home.status === 'fulfilled') setDashboard(home.value);
      else nextErrors.catalog = errorMessage(home.reason);
      if (historyBundle.status === 'fulfilled') {
        const { history, calendars } = historyBundle.value;
        setEntries(history.first.entries);
        setAnalyticsEntries(history.all);
        setNextCursor(history.first.nextCursor);
        setAsOf(history.first.asOfEventId);
        statuses.push(history.first.freshness);
        const calendarDays: CalendarDay[] = [];
        for (const calendar of calendars) {
          if (calendar.status === 'fulfilled') {
            calendarDays.push(...calendar.value.days);
            statuses.push(calendar.value.freshness);
            setAsOf((value) => value ?? calendar.value.asOfEventId);
          } else {
            nextErrors.calendar = errorMessage(calendar.reason);
          }
        }
        setDays(calendarDays);
      } else {
        nextErrors.history = errorMessage(historyBundle.reason);
        nextErrors.calendar = errorMessage(historyBundle.reason);
      }
      if (stats.status === 'fulfilled') {
        setStatistics(stats.value);
        setAsOf((value) => value ?? stats.value.asOfEventId);
        statuses.push(stats.value.freshness);
      } else nextErrors.statistics = errorMessage(stats.reason);
      if (weeklyView.status === 'fulfilled') {
        setWeekly(weeklyView.value.week);
        statuses.push(weeklyView.value.freshness);
      } else nextErrors.weekly = errorMessage(weeklyView.reason);
      if (report.status === 'fulfilled') setWeeklyReport(report.value);
      else nextErrors.weekly = errorMessage(report.reason);
      setFreshness(statuses.find((status) => status !== 'current') ?? 'current');
      setErrors(nextErrors);
      setLoadState('ready');
    });
    return () => {
      current = false;
    };
  }, [api, loadAttempt]);

  const filteredEntries = useMemo(
    () => entries.filter((entry) => factFilter === 'all' || entry.factType === factFilter),
    [entries, factFilter],
  );
  const calendarRecords = useMemo<readonly HistoryCalendarRecord[]>(() => {
    const lessonById = new Map(dashboard?.lessons.map((lesson) => [lesson.lessonId, lesson]) ?? []);
    const courseById = new Map(dashboard?.courses.map((course) => [course.courseId, course]) ?? []);
    const factByLessonAndDate = new Map<string, HistoryEntry>();
    for (const entry of analyticsEntries) {
      const lessonId = entry.subjectRefs.lessonId;
      if (entry.factType !== 'LessonCompletedFact' || lessonId === undefined) continue;
      factByLessonAndDate.set(`${localDate(entry.occurredAt)}:${lessonId}`, entry);
    }
    return days.flatMap((day) =>
      day.completedLessonIds.map((lessonId) => {
        const lesson = lessonById.get(lessonId);
        const fact = factByLessonAndDate.get(`${day.localDate}:${lessonId}`);
        const courseId = lesson?.courseId ?? fact?.subjectRefs.courseId;
        const exactSeconds = fact?.payload.actualSeconds;
        const seconds =
          typeof exactSeconds === 'number'
            ? exactSeconds
            : day.completedLessonIds.length === 0
              ? 0
              : day.actualSeconds / day.completedLessonIds.length;
        return {
          localDate: day.localDate,
          ...(courseId === undefined ? {} : { courseId }),
          lessonId,
          title: lesson?.title || lessonId,
          domain:
            toBroadDisciplineLabel(
              courseId === undefined ? undefined : courseById.get(courseId)?.disciplineTag,
            ) ?? '未分类领域',
          minutes: Math.max(0, Math.round(seconds / 60)),
        };
      }),
    );
  }, [analyticsEntries, dashboard, days]);
  const statisticsCourses = useMemo(
    () => buildStatisticsCourses({ dashboard, entries: analyticsEntries }),
    [analyticsEntries, dashboard],
  );
  const weeklyRecords = useMemo<readonly WeeklyReportRecord[]>(() => {
    const lessonById = new Map(dashboard?.lessons.map((lesson) => [lesson.lessonId, lesson]) ?? []);
    const courseById = new Map(dashboard?.courses.map((course) => [course.courseId, course]) ?? []);
    return (weeklyReport?.factSnapshot ?? []).flatMap((fact) => {
      if (fact.lessonId === undefined) return [];
      const lesson = lessonById.get(fact.lessonId);
      const courseId = fact.courseId ?? lesson?.courseId;
      const course = courseId === undefined ? undefined : courseById.get(courseId);
      return [
        {
          localDate: localDate(fact.occurredAt),
          lessonId: fact.lessonId,
          ...(courseId === undefined ? {} : { courseId }),
          title: lesson?.title || fact.lessonId,
          domain:
            toBroadDisciplineLabel(fact.disciplineTag ?? course?.disciplineTag) ?? '未分类领域',
          topic: fact.topicTags[0] ?? lesson?.title ?? '未分类主题',
        },
      ];
    });
  }, [dashboard, weeklyReport]);
  const today = localDate(new Date().toISOString());
  const currentWeek = isoWeek(today);
  const weeklyBounds =
    weeklyReport === undefined
      ? isoWeekBounds(currentWeek)
      : { start: weeklyReport.startLocalDate, end: weeklyReport.endLocalDate };
  const weeklySections = weeklyReportSections(weeklyReport?.markdown);
  const getStatisticsSnapshot = useCallback(
    (range: HistoryStatisticsRange, custom: Readonly<{ start: string; end: string }>) => {
      if (statistics === undefined) {
        throw new Error('statistics_workspace_data_unavailable');
      }
      return buildStatisticsSnapshot({
        range,
        custom,
        today,
        statistics,
        days,
        entries: analyticsEntries,
        dashboard,
      });
    },
    [analyticsEntries, dashboard, days, statistics, today],
  );

  const openSummary = (courseId: string) => {
    setSummaryDrawer({ open: true, courseId, loading: true });
    void api.getCourseSummary(courseId).then(
      (view) =>
        setSummaryDrawer({
          open: true,
          courseId,
          ...(view.course === undefined
            ? { error: '该课程尚无可汇总的学习事实。' }
            : { summary: view.course }),
        }),
      (reason: unknown) => setSummaryDrawer({ open: true, courseId, error: errorMessage(reason) }),
    );
  };
  const changeHistorySection = (next: HistorySection) => {
    setSection(next);
    navigate(
      next === 'calendar'
        ? '/history?tab=calendar'
        : next === 'portrait'
          ? '/history?tab=portrait'
          : '/history',
      { replace: true },
    );
  };

  if (loadState === 'loading') {
    return (
      <Page className="history-page">
        <section className="lm-content-state" aria-busy="true">
          <strong>正在加载历史</strong>
          <p>正在核对学习事实、统计与日历投影。</p>
        </section>
      </Page>
    );
  }

  if (showingWeekly) {
    const snapshotSeconds =
      weeklyReport?.factSnapshot.reduce((sum, fact) => sum + fact.actualSeconds, 0) ?? 0;
    const snapshotActiveDays = new Set(weeklyRecords.map((record) => record.localDate)).size;
    return (
      <WeeklyReportWorkspace
        activeDayCount={weekly?.activeDayCount ?? snapshotActiveDays}
        actualSeconds={weekly?.actualSeconds ?? snapshotSeconds}
        completedLessonCount={weekly?.completedLessonCount ?? weeklyRecords.length}
        evidenceSourceCount={weeklyReport?.factSnapshot.length ?? 0}
        exclusionCount={weeklyReport?.snapshotExclusions?.length ?? 0}
        endLocalDate={weeklyBounds.end}
        onBack={() => navigate('/')}
        onOpenRecord={(record) =>
          navigate(
            record.courseId === undefined
              ? `/lessons/${record.lessonId}`
              : `/courses/${record.courseId}/lessons/${record.lessonId}/record`,
          )
        }
        records={weeklyRecords}
        reportState={weeklyReport?.state ?? 'missing'}
        startLocalDate={weeklyBounds.start}
        {...(weeklySections.summary === undefined
          ? {}
          : { summaryMarkdown: weeklySections.summary })}
        {...(weeklySections.suggestion === undefined
          ? {}
          : { suggestionMarkdown: weeklySections.suggestion })}
      />
    );
  }

  if (section === 'calendar' && errors.calendar === undefined) {
    const currentMonth = today.slice(0, 7);
    const selected =
      calendarRecords.find((record) => record.localDate === today)?.localDate ??
      calendarRecords.find((record) => record.localDate.startsWith(`${currentMonth}-`))
        ?.localDate ??
      today;
    return (
      <>
        <HistoryCalendarWorkspace
          initialMonth={currentMonth}
          initialSelectedDate={selected}
          onOpenRecord={(record) =>
            navigate(
              record.courseId === undefined
                ? `/lessons/${record.lessonId}`
                : `/courses/${record.courseId}/lessons/${record.lessonId}/record`,
            )
          }
          onSectionChange={changeHistorySection}
          records={calendarRecords}
        />
        <CourseSummaryDrawer {...summaryDrawer} onClose={() => setSummaryDrawer({ open: false })} />
      </>
    );
  }

  if (section === 'statistics' && statistics !== undefined) {
    return (
      <>
        <div className="sr-only">
          <p>数据截至：{asOf ?? '空快照'}</p>
          {freshness === 'current' ? null : <span role="status">读模型状态：{freshness}</span>}
        </div>
        <HistoryStatisticsWorkspace
          catalogError={errors.catalog}
          courses={statisticsCourses}
          getSnapshot={getStatisticsSnapshot}
          initialCustomRange={{ start: `${today.slice(0, 4)}-06-01`, end: today }}
          onOpenCourse={(course) => navigate(`/courses/${course.courseId}`)}
          onSectionChange={changeHistorySection}
        />
        <CourseSummaryDrawer {...summaryDrawer} onClose={() => setSummaryDrawer({ open: false })} />
      </>
    );
  }

  if (section === 'portrait') {
    return <ProfilePage client={portraitApi} onSectionChange={changeHistorySection} />;
  }

  return (
    <Page className="history-page">
      <Stack>
        <header className="history-page-header">
          <p className="eyebrow">可追溯学习事实</p>
          <h1>学习历史</h1>
          <p>统计、日历与画像共享同一事实来源；课程与 Review 可从记录直接回溯。</p>
        </header>
        <HistorySectionTabs active={section} onChange={changeHistorySection} />
        <Stack {...historySectionPanelAttributes(section)}>
          <div className="history-projection-meta">
            {freshness === 'current' ? (
              <Badge tone="success">投影已同步</Badge>
            ) : (
              <Badge tone="warning" role="status">
                读模型状态：{freshness}
              </Badge>
            )}
            <p>数据截至：{asOf ?? '空快照'}</p>
            {Object.keys(errors).length === 0 ? null : (
              <Button
                type="button"
                variant="ghost"
                onClick={() => setLoadAttempt((value) => value + 1)}
              >
                重试失败模块
              </Button>
            )}
          </div>
          {section === 'statistics' ? (
            <Stack>
              {statistics === undefined ? (
                <ContentState
                  role="alert"
                  title="学习统计暂不可用"
                  description={errors.statistics}
                />
              ) : (
                <StatisticsPanel statistics={statistics} />
              )}
              <HistoryFilters value={factFilter} onChange={setFactFilter} />
              {errors.history === undefined ? (
                <HistoryTimeline
                  entries={filteredEntries}
                  {...(nextCursor === undefined ? {} : { nextCursor })}
                  onOpenCourseSummary={openSummary}
                  onLoadMore={() => {
                    if (nextCursor === undefined) return;
                    void api.getHistory(nextCursor).then(
                      (page) => {
                        setEntries((current) => [...current, ...page.entries]);
                        setNextCursor(page.nextCursor);
                        setPageError(undefined);
                      },
                      (reason: unknown) => setPageError(errorMessage(reason)),
                    );
                  }}
                />
              ) : (
                <ContentState
                  role="alert"
                  title="学习时间线暂不可用"
                  description={errors.history}
                />
              )}
              {pageError === undefined ? null : <p role="alert">{pageError}</p>}
              {errors.weekly === undefined ? (
                <WeeklyReportView
                  {...(weekly === undefined ? {} : { week: weekly })}
                  {...(weeklyReport === undefined ? {} : { report: weeklyReport })}
                />
              ) : (
                <ContentState role="alert" title="本周回顾暂不可用" description={errors.weekly} />
              )}
            </Stack>
          ) : null}
          {section === 'calendar' ? (
            <ContentState role="alert" title="学习日历暂不可用" description={errors.calendar} />
          ) : null}
        </Stack>
      </Stack>
      <CourseSummaryDrawer {...summaryDrawer} onClose={() => setSummaryDrawer({ open: false })} />
    </Page>
  );
}
