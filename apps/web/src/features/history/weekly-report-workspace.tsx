import { useMemo, useState } from 'react';

import { AiContent, Page } from '@learning-more/ui';

import './weekly-report-workspace.css';

export type WeeklyReportRecord = Readonly<{
  localDate: string;
  lessonId: string;
  courseId?: string;
  title: string;
  domain: string;
  topic: string;
}>;

type ReportState = 'generating' | 'failed' | 'finalized' | 'missing';

const weekdayLabels = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const;

function dateRange(start: string, end: string): readonly string[] {
  const cursor = new Date(`${start}T00:00:00.000Z`);
  const boundary = new Date(`${end}T00:00:00.000Z`);
  const result: string[] = [];
  while (cursor < boundary && result.length < 7) {
    result.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

function monthDay(value: string): string {
  return value.slice(5).replace('-', '/');
}

function previousLocalDate(value: string): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export function WeeklyReportWorkspace(props: {
  readonly startLocalDate: string;
  readonly endLocalDate: string;
  readonly records: readonly WeeklyReportRecord[];
  readonly completedLessonCount: number;
  readonly actualSeconds: number;
  readonly activeDayCount: number;
  readonly reportState: ReportState;
  readonly evidenceSourceCount?: number;
  readonly exclusionCount?: number;
  readonly summaryMarkdown?: string;
  readonly defaultExpanded?: boolean;
  readonly onBack: () => void;
  readonly onOpenRecord: (record: WeeklyReportRecord) => void;
}) {
  const [expanded, setExpanded] = useState(props.defaultExpanded ?? false);
  const [selectedDate, setSelectedDate] = useState('');
  const [domain, setDomain] = useState('');
  const [topic, setTopic] = useState('');
  const dates = useMemo(
    () => dateRange(props.startLocalDate, props.endLocalDate),
    [props.endLocalDate, props.startLocalDate],
  );
  const domains = [...new Set(props.records.map((record) => record.domain))];
  const topics = [...new Set(props.records.map((record) => record.topic))];
  const visibleRecords = props.records.filter((record) =>
    selectedDate !== ''
      ? record.localDate === selectedDate
      : (domain === '' || record.domain === domain) && (topic === '' || record.topic === topic),
  );
  const clearSelectedDate = () => setSelectedDate('');

  return (
    <Page className="weekly-report-workspace">
      <section className="lm-card weekly-report-hero">
        <div>
          <div className="lm-kicker">WEEKLY REFLECTION</div>
          <h1>上周学习回顾</h1>
          <p>
            {props.startLocalDate.replaceAll('-', '/')} —{' '}
            {monthDay(previousLocalDate(props.endLocalDate))} · 已完成 {props.completedLessonCount}{' '}
            节课
          </p>
        </div>
        <button className="lm-btn" onClick={props.onBack} type="button">
          返回本周课程表
        </button>
      </section>
      <div className="weekly-report-layout week-workspace-layout">
        <aside className="lm-card weekly-report-days week-workspace-rail">
          <header>
            <b>上周学习</b>
          </header>
          {dates.map((date) => {
            const dateRecords = props.records.filter((record) => record.localDate === date);
            return (
              <button
                aria-pressed={selectedDate === date}
                className={`weekly-report-day${selectedDate === date ? ' active' : ''}`}
                key={date}
                onClick={() => {
                  setSelectedDate(date);
                  setDomain('');
                  setTopic('');
                }}
                type="button"
              >
                <span className="weekly-report-day-date">
                  <small>{weekdayLabels[new Date(`${date}T00:00:00.000Z`).getUTCDay()]}</small>
                  <b>{monthDay(date)}</b>
                </span>
                {dateRecords.length === 0 ? (
                  <span className="week-course-empty">暂无学习</span>
                ) : (
                  <span className="week-course-list" role="list">
                    {dateRecords.map((record) => (
                      <span className="week-course-item" key={record.lessonId} role="listitem">
                        {record.title}
                      </span>
                    ))}
                  </span>
                )}
              </button>
            );
          })}
        </aside>
        <section className="lm-card weekly-report-main week-workspace-main">
          <section className={`weekly-report-box${expanded ? ' open' : ''}`}>
            <button
              aria-expanded={expanded}
              className="weekly-report-head"
              onClick={() => setExpanded((value) => !value)}
              type="button"
            >
              <span>上周学习报告</span>
              <span aria-hidden="true">{expanded ? '−' : '+'}</span>
            </button>
            <div className="weekly-report-body" hidden={!expanded}>
              {props.reportState === 'finalized' ? (
                <div className="weekly-report-insights">
                  <section>
                    <AiContent markdown={props.summaryMarkdown ?? '上周没有可概括的已完成课节。'} />
                  </section>
                </div>
              ) : (
                <div
                  className="weekly-report-state"
                  role={props.reportState === 'failed' ? 'alert' : 'status'}
                >
                  {props.reportState === 'generating'
                    ? '上周学习成果正在汇总。'
                    : props.reportState === 'failed'
                      ? '周报生成失败；完成课节事实不受影响，系统将自动重新汇总。'
                      : '上周学习成果正在汇总。'}
                </div>
              )}
            </div>
          </section>
          <div className="weekly-report-filters">
            <select
              aria-label="学科 / 领域"
              className="lm-control"
              onChange={(event) => {
                setDomain(event.target.value);
                clearSelectedDate();
              }}
              value={domain}
            >
              <option value="">全部学科 / 领域</option>
              {domains.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
            <select
              aria-label="主题标签"
              className="lm-control"
              onChange={(event) => {
                setTopic(event.target.value);
                clearSelectedDate();
              }}
              value={topic}
            >
              <option value="">全部主题标签</option>
              {topics.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </div>
          <div className="lm-section-title weekly-report-section-title">
            <div>
              <h2>已完成课节</h2>
              <p>
                {selectedDate === '' ? '上周全部' : monthDay(selectedDate)} ·{' '}
                {visibleRecords.length} 节
              </p>
            </div>
          </div>
          <div className="weekly-report-list">
            {visibleRecords.length === 0 ? (
              <div className="lm-empty">当前日期或筛选条件下没有已完成课节。</div>
            ) : (
              visibleRecords.map((record) => (
                <button
                  className="weekly-report-lesson"
                  data-lesson-id={record.lessonId}
                  key={`${record.localDate}:${record.lessonId}`}
                  onClick={() => props.onOpenRecord(record)}
                  type="button"
                >
                  <b>{record.title}</b>
                  <p>
                    {record.domain} · {record.topic} · 点击查看课节记录
                  </p>
                </button>
              ))
            )}
          </div>
        </section>
      </div>
    </Page>
  );
}
