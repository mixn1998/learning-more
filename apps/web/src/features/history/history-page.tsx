import { useEffect, useMemo, useState } from 'react';

import {
  historyClient,
  type HistoryClient,
  type HistoryEntry,
} from '../../client/history-client.js';
import { CalendarView } from './calendar-view.js';
import { HistoryTimeline } from './history-timeline.js';
import { HistorySectionTabs, type HistorySection } from './history-section-tabs.js';
import { StatisticsPanel } from './statistics-panel.js';
import { WeeklyReportView } from './weekly-report-view.js';

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

export function HistoryPage(props: { readonly client?: HistoryClient }) {
  const api = props.client ?? historyClient;
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<readonly HistoryEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string>();
  const [statistics, setStatistics] = useState<Record<string, unknown>>({});
  const [days, setDays] = useState<
    readonly { localDate: string; actualSeconds: number; completedLessonIds: readonly string[] }[]
  >([]);
  const [freshness, setFreshness] = useState('current');
  const [asOf, setAsOf] = useState<string>();
  const [selectedDate, setSelectedDate] = useState<string>();
  const [weekly, setWeekly] = useState<Record<string, unknown>>();
  const [weeklyReport, setWeeklyReport] = useState<Record<string, unknown>>();
  const [section, setSection] = useState<HistorySection>('statistics');
  useEffect(() => {
    const currentWeek = isoWeek(localDate(new Date().toISOString()));
    void Promise.all([
      api.getHistory(),
      api.getStatistics(),
      api.getCalendar('2026-01-01', '2026-12-31'),
      api.getWeekly(currentWeek),
      api.getWeeklyReport(currentWeek),
    ]).then(([history, stats, calendar, weeklyView, report]) => {
      setEntries(history.entries);
      setNextCursor(history.nextCursor);
      setStatistics(stats);
      setDays(calendar.days);
      setFreshness(
        [history.freshness, stats.freshness, calendar.freshness].find(
          (value) => value !== 'current',
        ) ?? 'current',
      );
      setAsOf(history.asOfEventId);
      setWeekly(weeklyView.week);
      setWeeklyReport(report);
      setLoading(false);
    });
  }, [api]);
  const visible = useMemo(
    () =>
      selectedDate === undefined
        ? entries
        : entries.filter(
            (entry) =>
              entry.factType === 'LessonCompletedFact' &&
              localDate(entry.occurredAt) === selectedDate,
          ),
    [entries, selectedDate],
  );
  if (loading)
    return (
      <main>
        <p>正在加载历史</p>
      </main>
    );
  return (
    <main className="authoring-workspace">
      <h1>学习历史</h1>
      <HistorySectionTabs active={section} onChange={setSection} />
      {freshness === 'current' ? null : <p role="status">读模型状态：{freshness}</p>}
      <p>数据截至：{asOf ?? '空快照'}</p>
      {section === 'statistics' ? (
        <>
          <StatisticsPanel statistics={statistics} />
          <HistoryTimeline
            entries={entries}
            {...(nextCursor === undefined ? {} : { nextCursor })}
            onLoadMore={() => {
              if (nextCursor === undefined) return;
              void api.getHistory(nextCursor).then((page) => {
                setEntries((current) => [...current, ...page.entries]);
                setNextCursor(page.nextCursor);
              });
            }}
          />
          <WeeklyReportView
            {...(weekly === undefined ? {} : { week: weekly })}
            {...(weeklyReport === undefined ? {} : { report: weeklyReport })}
          />
        </>
      ) : null}
      {section === 'calendar' ? (
        <>
          <CalendarView
            days={days}
            {...(selectedDate === undefined ? {} : { selectedDate })}
            onSelect={setSelectedDate}
          />
          <HistoryTimeline entries={visible} onLoadMore={() => undefined} />
        </>
      ) : null}
      {section === 'portrait' ? (
        <section className="authoring-panel">
          <h2>学习画像</h2>
          <a href="/profile">打开当前画像与证据链</a>
        </section>
      ) : null}
    </main>
  );
}
