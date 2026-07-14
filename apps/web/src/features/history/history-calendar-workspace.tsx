import { useMemo, useState } from 'react';

import { Page } from '@learning-more/ui';

import { HistorySectionTabs, historySectionPanelAttributes } from './history-section-tabs.js';
import './history-calendar-workspace.css';

export type HistoryCalendarRecord = Readonly<{
  localDate: string;
  courseId?: string;
  lessonId: string;
  title: string;
  domain: string;
  minutes: number;
}>;

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function localDate(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function HistoryCalendarWorkspace(props: {
  readonly records: readonly HistoryCalendarRecord[];
  readonly initialMonth: string;
  readonly initialSelectedDate: string;
  readonly onSectionChange: (section: 'statistics' | 'calendar' | 'portrait') => void;
  readonly onOpenRecord: (record: HistoryCalendarRecord) => void;
}) {
  const [initialYear, initialMonth] = props.initialMonth.split('-').map(Number) as [number, number];
  const [month, setMonth] = useState(() => new Date(initialYear, initialMonth - 1, 1));
  const [selectedDate, setSelectedDate] = useState(props.initialSelectedDate);
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const currentMonthKey = monthKey(month);
  const monthRecords = useMemo(
    () => props.records.filter((record) => record.localDate.startsWith(`${currentMonthKey}-`)),
    [currentMonthKey, props.records],
  );
  const recordsByDate = useMemo(() => {
    const result = new Map<string, HistoryCalendarRecord[]>();
    for (const record of monthRecords) {
      result.set(record.localDate, [...(result.get(record.localDate) ?? []), record]);
    }
    return result;
  }, [monthRecords]);
  const selected = recordsByDate.get(selectedDate) ?? [];
  const firstWeekday = new Date(year, monthIndex, 1).getDay();
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const daysInPreviousMonth = new Date(year, monthIndex, 0).getDate();
  const cells = Array.from({ length: 42 }, (_, index) => {
    const day = index - firstWeekday + 1;
    if (day < 1) return { day: daysInPreviousMonth + day, muted: true, offset: -1 } as const;
    if (day > daysInMonth) return { day: day - daysInMonth, muted: true, offset: 1 } as const;
    return { day, muted: false, offset: 0 } as const;
  });

  const moveMonth = (offset: number) => {
    const next = new Date(year, monthIndex + offset, 1);
    setMonth(next);
    setSelectedDate(localDate(next.getFullYear(), next.getMonth(), 1));
  };

  return (
    <Page className="history-calendar-workspace">
      <section className="lm-card history-calendar-hero">
        <div className="lm-kicker">LEARNING CALENDAR</div>
        <h1>学习日历</h1>
      </section>
      <HistorySectionTabs
        active="calendar"
        className="history-primary-nav"
        onChange={props.onSectionChange}
        tabClassName={(_section, active) => `history-tab${active ? ' active' : ''}`}
      />
      <section
        {...historySectionPanelAttributes('calendar')}
        className="lm-card history-calendar-card"
      >
        <div className="history-calendar-layout">
          <div>
            <div className="history-month-head">
              <div>
                <h2>学习日历</h2>
                <p>
                  {recordsByDate.size} 个学习日 · {monthRecords.length} 节已完成课节
                </p>
              </div>
              <div className="history-month-controls">
                <button
                  aria-label="上个月"
                  className="lm-btn"
                  onClick={() => moveMonth(-1)}
                  type="button"
                >
                  ‹
                </button>
                <b>
                  {year} 年 {monthIndex + 1} 月
                </b>
                <button
                  aria-label="下个月"
                  className="lm-btn"
                  onClick={() => moveMonth(1)}
                  type="button"
                >
                  ›
                </button>
              </div>
            </div>
            <div aria-hidden="true" className="history-weekdays">
              <span>日</span>
              <span>一</span>
              <span>二</span>
              <span>三</span>
              <span>四</span>
              <span>五</span>
              <span>六</span>
            </div>
            <div className="history-calendar-month-grid">
              {cells.map((cell, index) => {
                if (cell.muted) {
                  return (
                    <div className="history-date muted" key={`${cell.offset}:${cell.day}:${index}`}>
                      <b>{cell.day}</b>
                    </div>
                  );
                }
                const value = localDate(year, monthIndex, cell.day);
                const records = recordsByDate.get(value) ?? [];
                return (
                  <button
                    aria-label={`${value}，${records.length} 节已完成`}
                    className={`history-date${value === selectedDate ? ' active' : ''}`}
                    key={value}
                    onClick={() => setSelectedDate(value)}
                    type="button"
                  >
                    <b>{cell.day}</b>
                    {records.slice(0, 2).map((record) => (
                      <span
                        className="history-date-course"
                        key={record.lessonId}
                        title={record.title}
                      >
                        {record.title}
                      </span>
                    ))}
                    {records.length > 2 ? (
                      <span className="history-date-overflow">另有 {records.length - 2} 节</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
          <aside className="history-day-detail">
            <h3>
              {Number(selectedDate.slice(5, 7))} 月 {Number(selectedDate.slice(8, 10))} 日
            </h3>
            <span className="lm-pill">{selected.length} 节已完成</span>
            <div>
              {selected.length === 0 ? (
                <div className="history-empty-detail">当天暂无已归档课节</div>
              ) : (
                selected.map((record) => (
                  <div key={record.lessonId}>
                    <button
                      className="history-record"
                      onClick={() => props.onOpenRecord(record)}
                      type="button"
                    >
                      <b>{record.title}</b>
                      <br />
                      <small>
                        {record.domain} · {record.minutes} 分钟
                      </small>
                    </button>
                    {record.courseId === undefined ? null : (
                      <>
                        <a className="sr-only" href={`/courses/${record.courseId}`}>
                          打开课程
                        </a>
                        <a
                          className="sr-only"
                          href={`/courses/${record.courseId}/lessons/${record.lessonId}/record?tab=review`}
                        >
                          打开 Review
                        </a>
                      </>
                    )}
                  </div>
                ))
              )}
            </div>
          </aside>
        </div>
      </section>
    </Page>
  );
}
