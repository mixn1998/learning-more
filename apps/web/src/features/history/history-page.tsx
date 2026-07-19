import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import {
  completedWeeklyReportWindow,
  nextWeeklyReportBoundary,
  type CalendarDay,
  type CatalogIndexView,
  type CourseSummary,
  type HistoryEntry,
  type StatisticsResponse,
  type WeeklyReportResponse,
} from '@learning-more/contracts';
import { Badge, Button, ContentState, Page, Stack } from '@learning-more/ui';

import { historyClient, type HistoryClient } from '../../client/history-client.js';
import { toBroadDisciplineLabel } from '../../discipline-label.js';
import { profileClient, type ProfileClient } from '../../client/profile-client.js';
import { useAppShellBrandSubtitle, useAppShellHeaderStatus } from '../../state/app-shell-header.js';
import {
  calendarSnapshotCache,
  catalogIndexCache,
  statisticsSnapshotCache,
  weeklyReportSnapshotCache,
} from '../../state/dashboard-query-caches.js';
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

function weeklyReportSummary(markdown: string | undefined): string | undefined {
  const content = markdown?.trim();
  if (content === undefined || content === '') return undefined;
  const summary = content.replace(/^#{1,6}\s*[^\n]+\n?/u, '').trim();
  return summary === '' ? undefined : summary;
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
  const usesSharedCache = props.client === undefined;
  const portraitApi = props.portraitClient ?? profileClient;
  const location = useLocation();
  const navigate = useNavigate();
  const requestedTab = new URLSearchParams(location.search).get('tab');
  const showingWeekly = requestedTab === 'weekly';
  const initialSection: HistorySection =
    requestedTab === 'calendar'
      ? 'calendar'
      : requestedTab === 'portrait'
        ? 'portrait'
        : 'statistics';
  const initialYear = localDate(new Date().toISOString()).slice(0, 4);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const reportWindow = useMemo(
    () => completedWeeklyReportWindow(new Date(), 'Asia/Shanghai'),
    [loadAttempt],
  );
  const initialCatalog = usesSharedCache ? catalogIndexCache.read() : undefined;
  const initialStatistics = usesSharedCache ? statisticsSnapshotCache.read() : undefined;
  const initialCalendar = usesSharedCache ? calendarSnapshotCache(initialYear).read() : undefined;
  const initialWeeklyReport = usesSharedCache
    ? weeklyReportSnapshotCache(reportWindow.localWeekKey).read()?.report
    : undefined;
  const hasInitialSnapshot = showingWeekly
    ? initialWeeklyReport !== undefined
    : initialSection === 'calendar'
      ? initialCalendar !== undefined
      : initialSection === 'portrait' || initialStatistics !== undefined;
  const [loadState, setLoadState] = useState<'loading' | 'ready'>(
    hasInitialSnapshot ? 'ready' : 'loading',
  );
  const [errors, setErrors] = useState<LoadErrors>({});
  const [pageError, setPageError] = useState<string>();
  const [entries, setEntries] = useState<readonly HistoryEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string>();
  const [statistics, setStatistics] = useState<StatisticsResponse | undefined>(initialStatistics);
  const [dashboard, setDashboard] = useState<CatalogIndexView | undefined>(initialCatalog);
  const [days, setDays] = useState<readonly CalendarDay[]>(initialCalendar?.days ?? []);
  const [freshness, setFreshness] = useState<'current' | 'stale' | 'rebuilding'>('current');
  const [asOf, setAsOf] = useState<string>();
  const [factFilter, setFactFilter] = useState<HistoryFactFilter>('all');
  const [weeklyReport, setWeeklyReport] = useState<WeeklyReportResponse | undefined>(
    initialWeeklyReport,
  );
  const [section, setSection] = useState<HistorySection>(initialSection);
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
          : { tone: 'warning', text: '● 本周快照生成中' }
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
    if (section === 'portrait' && !showingWeekly) {
      setLoadState('ready');
      return () => {
        current = false;
      };
    }
    const sectionHasSnapshot = showingWeekly
      ? weeklyReport !== undefined
      : section === 'calendar'
        ? days.length > 0
        : statistics !== undefined;
    if (!sectionHasSnapshot) setLoadState('loading');
    setErrors({});
    setPageError(undefined);
    const applyCatalog = (home: PromiseSettledResult<CatalogIndexView>) => {
      if (!current) return;
      if (home.status === 'fulfilled') setDashboard(home.value);
      else setErrors((value) => ({ ...value, catalog: errorMessage(home.reason) }));
    };
    const getCatalog = () =>
      usesSharedCache
        ? catalogIndexCache.revalidate().then(() => catalogIndexCache.read()!)
        : api.getCatalog();
    const getStatistics = () =>
      usesSharedCache
        ? statisticsSnapshotCache.revalidate().then(() => statisticsSnapshotCache.read()!)
        : api.getStatistics();
    const getCalendar = () =>
      usesSharedCache
        ? calendarSnapshotCache(year)
            .revalidate()
            .then(() => calendarSnapshotCache(year).read()!)
        : api.getCalendar(`${year}-01-01`, `${year}-12-31`);
    const getWeeklyReport = () =>
      usesSharedCache
        ? weeklyReportSnapshotCache(reportWindow.localWeekKey)
            .revalidate()
            .then(() => weeklyReportSnapshotCache(reportWindow.localWeekKey).read()?.report)
        : api.getWeeklyReport(reportWindow.localWeekKey);
    const applyStatistics = (stats: PromiseSettledResult<StatisticsResponse>) => {
      if (!current) return;
      if (stats.status === 'fulfilled') {
        setStatistics(stats.value);
        setAsOf((value) => value ?? stats.value.asOfEventId);
        setFreshness(stats.value.freshness);
      } else {
        setErrors((value) => ({ ...value, statistics: errorMessage(stats.reason) }));
      }
    };

    if (showingWeekly) {
      void Promise.allSettled([getCatalog(), getWeeklyReport()]).then(([home, report]) => {
        if (!current) return;
        applyCatalog(home);
        if (report.status === 'fulfilled') setWeeklyReport(report.value);
        else setErrors((value) => ({ ...value, weekly: errorMessage(report.reason) }));
        setLoadState('ready');
      });
    } else if (section === 'calendar') {
      void Promise.allSettled([getCatalog(), getCalendar()]).then(([home, calendar]) => {
        if (!current) return;
        applyCatalog(home);
        if (calendar.status === 'fulfilled') {
          setDays(calendar.value.days);
          setAsOf(calendar.value.asOfEventId);
          setFreshness(calendar.value.freshness);
        } else {
          setErrors((value) => ({ ...value, calendar: errorMessage(calendar.reason) }));
        }
        setLoadState('ready');
      });
    } else {
      void Promise.allSettled([getCatalog()]).then(([home]) => {
        applyCatalog(home);
      });
      void Promise.allSettled([getStatistics()]).then(([stats]) => {
        if (!current) return;
        applyStatistics(stats);
        setLoadState('ready');
      });
    }
    return () => {
      current = false;
    };
  }, [api, loadAttempt, reportWindow.localWeekKey, section, showingWeekly, usesSharedCache]);

  useEffect(() => {
    const now = new Date();
    const delay = Math.max(
      1,
      nextWeeklyReportBoundary(now, 'Asia/Shanghai').getTime() - now.getTime() + 250,
    );
    const timer = setTimeout(() => setLoadAttempt((value) => value + 1), delay);
    return () => clearTimeout(timer);
  }, [loadAttempt]);

  useEffect(() => {
    if (!showingWeekly || loadState !== 'ready') return;
    if (weeklyReport !== undefined && weeklyReport.state !== 'generating') return;
    const timer = setTimeout(() => setLoadAttempt((value) => value + 1), 5_000);
    return () => clearTimeout(timer);
  }, [loadState, showingWeekly, weeklyReport]);

  const filteredEntries = useMemo(
    () => entries.filter((entry) => factFilter === 'all' || entry.factType === factFilter),
    [entries, factFilter],
  );
  const calendarRecords = useMemo<readonly HistoryCalendarRecord[]>(() => {
    const lessonById = new Map(dashboard?.lessons.map((lesson) => [lesson.lessonId, lesson]) ?? []);
    const courseById = new Map(dashboard?.courses.map((course) => [course.courseId, course]) ?? []);
    return days.flatMap((day) =>
      ((day.completions ?? []).length > 0
        ? day.completions
        : day.completedLessonIds.map((lessonId) => ({
            lessonId,
            courseId: undefined,
            actualSeconds:
              day.completedLessonIds.length === 0
                ? 0
                : day.actualSeconds / day.completedLessonIds.length,
          }))
      ).map((completion) => {
        const lessonId = completion.lessonId;
        const lesson = lessonById.get(lessonId);
        const courseId = completion.courseId ?? lesson?.courseId;
        return {
          localDate: day.localDate,
          ...(courseId === undefined ? {} : { courseId }),
          lessonId,
          title: lesson?.title || lessonId,
          domain:
            toBroadDisciplineLabel(
              courseId === undefined ? undefined : courseById.get(courseId)?.disciplineTag,
            ) ?? '未分类领域',
          minutes: Math.max(0, Math.round(completion.actualSeconds / 60)),
        };
      }),
    );
  }, [dashboard, days]);
  const statisticsCourses = useMemo(
    () =>
      buildStatisticsCourses({
        ...(dashboard === undefined ? {} : { dashboard }),
        ...(statistics === undefined ? {} : { statistics }),
      }),
    [dashboard, statistics],
  );
  const completedWeeklySnapshotFacts = useMemo(
    () =>
      (weeklyReport?.factSnapshot ?? []).filter((fact) => fact.summary === 'LessonCompletedFact'),
    [weeklyReport],
  );
  const weeklySnapshotSummary = useMemo(
    () =>
      weeklyReport === undefined
        ? undefined
        : {
            isoWeek: weeklyReport.localWeekKey,
            timezone: weeklyReport.timezone,
            actualSeconds: completedWeeklySnapshotFacts.reduce(
              (sum, fact) => sum + fact.actualSeconds,
              0,
            ),
            completedLessonCount: completedWeeklySnapshotFacts.length,
            activeDayCount: new Set(
              completedWeeklySnapshotFacts.map((fact) => localDate(fact.occurredAt)),
            ).size,
          },
    [completedWeeklySnapshotFacts, weeklyReport],
  );
  const weeklyRecords = useMemo<readonly WeeklyReportRecord[]>(() => {
    const lessonById = new Map(dashboard?.lessons.map((lesson) => [lesson.lessonId, lesson]) ?? []);
    const courseById = new Map(dashboard?.courses.map((course) => [course.courseId, course]) ?? []);
    return completedWeeklySnapshotFacts.flatMap((fact) => {
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
  }, [completedWeeklySnapshotFacts, dashboard]);
  const today = localDate(new Date().toISOString());
  const weeklyBounds =
    weeklyReport === undefined
      ? { start: reportWindow.startLocalDate, end: reportWindow.endLocalDate }
      : { start: weeklyReport.startLocalDate, end: weeklyReport.endLocalDate };
  const weeklySummary = weeklyReportSummary(weeklyReport?.markdown);
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
        dashboard,
      });
    },
    [dashboard, statistics, today],
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

  if (section === 'portrait' && !showingWeekly) {
    return <ProfilePage client={portraitApi} onSectionChange={changeHistorySection} />;
  }

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
    return (
      <WeeklyReportWorkspace
        activeDayCount={weeklySnapshotSummary?.activeDayCount ?? 0}
        actualSeconds={weeklySnapshotSummary?.actualSeconds ?? 0}
        completedLessonCount={weeklySnapshotSummary?.completedLessonCount ?? 0}
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
        reportState={weeklyReport?.state ?? 'generating'}
        startLocalDate={weeklyBounds.start}
        {...(weeklySummary === undefined ? {} : { summaryMarkdown: weeklySummary })}
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
                  {...(weeklySnapshotSummary === undefined ? {} : { week: weeklySnapshotSummary })}
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
