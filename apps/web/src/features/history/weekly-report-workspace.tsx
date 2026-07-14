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
  while (cursor <= boundary && result.length < 7) {
    result.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

function monthDay(value: string): string {
  return value.slice(5).replace('-', '/');
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
  readonly suggestionMarkdown?: string;
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
            {props.startLocalDate.replaceAll('-', '/')} — {monthDay(props.endLocalDate)} · 已完成{' '}
            {props.completedLessonCount} 节课
          </p>
        </div>
        <button className="lm-btn" onClick={props.onBack} type="button">
          返回本周课程表
        </button>
      </section>
      <div className="weekly-report-layout">
        <aside className="lm-card weekly-report-days">
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
                <span>{dateRecords.map((record) => record.title).join(' · ') || '暂无学习'}</span>
              </button>
            );
          })}
        </aside>
        <section className="lm-card weekly-report-main">
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
              <p className="weekly-report-lineage">
                冻结证据 {props.evidenceSourceCount ?? 0} 条
                {(props.exclusionCount ?? 0) === 0
                  ? ' · 本周窗口内来源已核验'
                  : ` · ${props.exclusionCount} 条来源因不在本周窗口或已失效而排除`}
              </p>
              <div className="weekly-report-metrics">
                <div className="weekly-report-metric">
                  <span>完成课节</span>
                  <b>{props.completedLessonCount}</b>
                </div>
                <div className="weekly-report-metric">
                  <span>学习时长</span>
                  <b>{Math.round(props.actualSeconds / 60)} min</b>
                </div>
                <div className="weekly-report-metric">
                  <span>活跃天数</span>
                  <b>{props.activeDayCount}</b>
                </div>
              </div>
              {props.reportState === 'finalized' ? (
                <div className="weekly-report-insights">
                  <section>
                    <h3>AI 总结</h3>
                    <AiContent markdown={props.summaryMarkdown ?? '本周报告未生成总结。'} />
                  </section>
                  <section>
                    <h3>下周建议</h3>
                    <AiContent
                      markdown={props.suggestionMarkdown ?? '本周报告未单独生成下周建议。'}
                    />
                  </section>
                </div>
              ) : (
                <div
                  className="weekly-report-state"
                  role={props.reportState === 'failed' ? 'alert' : 'status'}
                >
                  {props.reportState === 'generating'
                    ? '周报生成中，完成后会冻结为只读版本。'
                    : props.reportState === 'failed'
                      ? '周报生成失败；学习事实不受影响。'
                      : '暂无周报。'}
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
