import { useMemo, useRef, useState } from 'react';

import { Page } from '@learning-more/ui';

import {
  HistorySectionTabs,
  historySectionPanelAttributes,
  type HistorySection,
} from './history-section-tabs.js';
import './history-statistics-workspace.css';

export type HistoryStatisticsRange = '30d' | 'year' | 'all' | 'custom';

export type HistoryStatisticsWeek = Readonly<{
  startDate: string;
  endDate: string;
  durationMinutes: number;
  lessonCount: number;
  height: number;
}>;

export type HistoryStatisticsSnapshot = Readonly<{
  hours: string;
  completedLessons: number;
  closedCourses: number;
  activeDays: number;
  courseCount: number;
  abandonedCourseCount: number;
  currentStreakDays: number;
  longestStreakDays: number;
  weeklyTrend: readonly HistoryStatisticsWeek[];
  disciplines: readonly Readonly<{ label: string; percent: number; hours: string }>[];
  interactionResponseRate: number;
  interactionSkipped: number;
}>;

export type HistoryStatisticsCourse = Readonly<{
  courseId: string;
  title: string;
  domain: string;
  topics: string;
  status: '学习中' | '已关闭';
  mode: string;
  disposition: string;
  duration: string;
  durationMinutes: number;
  recentDate: string;
  reviewAvailable: boolean;
}>;

type DateRange = Readonly<{ start: string; end: string }>;

const DISCIPLINE_PREVIEW_LIMIT = 8;

export function HistoryStatisticsWorkspace(props: {
  readonly getSnapshot: (
    range: HistoryStatisticsRange,
    custom: DateRange,
  ) => HistoryStatisticsSnapshot;
  readonly courses: readonly HistoryStatisticsCourse[];
  readonly catalogError?: string | undefined;
  readonly initialCustomRange?: DateRange;
  readonly onSectionChange: (section: HistorySection) => void;
  readonly onOpenCourse: (course: HistoryStatisticsCourse) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [range, setRange] = useState<HistoryStatisticsRange>('year');
  const [custom, setCustom] = useState<DateRange>(
    props.initialCustomRange ?? { start: '2026-06-01', end: '2026-07-12' },
  );
  const [draftCustom, setDraftCustom] = useState(custom);
  const [rangeError, setRangeError] = useState<string>();
  const [status, setStatus] = useState('');
  const [domain, setDomain] = useState('');
  const [mode, setMode] = useState('');
  const [sort, setSort] = useState<'recent' | 'oldest' | 'duration'>('recent');
  const [showAllDisciplines, setShowAllDisciplines] = useState(false);
  const [hoveredWeek, setHoveredWeek] = useState<number>();
  const [focusedWeek, setFocusedWeek] = useState<number>();
  const [pinnedWeek, setPinnedWeek] = useState<number>();
  const snapshot = props.getSnapshot(range, custom);
  const visibleWeek = hoveredWeek ?? focusedWeek ?? pinnedWeek;
  const visibleDisciplines = showAllDisciplines
    ? snapshot.disciplines
    : snapshot.disciplines.slice(0, DISCIPLINE_PREVIEW_LIMIT);
  const hasHiddenDisciplines = snapshot.disciplines.length > DISCIPLINE_PREVIEW_LIMIT;
  const domains = [...new Set(props.courses.map((course) => course.domain))];
  const modes = [...new Set(props.courses.map((course) => course.mode))];
  const visibleCourses = useMemo(() => {
    const selected = props.courses.filter(
      (course) =>
        (status === '' || course.status === status) &&
        (domain === '' || course.domain === domain) &&
        (mode === '' || course.mode === mode),
    );
    return [...selected].sort((left, right) =>
      sort === 'duration'
        ? right.durationMinutes - left.durationMinutes
        : sort === 'oldest'
          ? left.recentDate.localeCompare(right.recentDate)
          : right.recentDate.localeCompare(left.recentDate),
    );
  }, [domain, mode, props.courses, sort, status]);

  const chooseRange = (next: HistoryStatisticsRange) => {
    if (next !== 'custom') {
      setRange(next);
      return;
    }
    setDraftCustom(custom);
    setRangeError(undefined);
    if (typeof dialog.current?.showModal === 'function') dialog.current.showModal();
    else dialog.current?.setAttribute('open', '');
  };

  const closeDialog = () => {
    if (typeof dialog.current?.close === 'function') dialog.current.close();
    else dialog.current?.removeAttribute('open');
  };

  const applyCustomRange = () => {
    if (draftCustom.start === '' || draftCustom.end === '' || draftCustom.start > draftCustom.end) {
      setRangeError('请选择有效的日期范围');
      return;
    }
    setCustom(draftCustom);
    setRange('custom');
    setRangeError(undefined);
    closeDialog();
  };

  return (
    <Page className="history-statistics-workspace">
      <section className="lm-card history-stat-hero">
        <div>
          <div className="lm-kicker">LEARNING ARCHIVE</div>
          <h1>历史统计</h1>
        </div>
      </section>
      <HistorySectionTabs
        active="statistics"
        className="history-primary-nav"
        onChange={props.onSectionChange}
        tabClassName={(_section, active) => `history-tab${active ? ' active' : ''}`}
      />
      <section
        {...historySectionPanelAttributes('statistics')}
        className="lm-card history-stat-shell"
      >
        <section className="history-stat-view">
          <div className="history-stat-toolbar">
            <div>
              <h2>学习统计</h2>
              <p>当前范围内只统计最终完成课节；已放弃和未完成不计入。</p>
            </div>
            <div className="history-stat-filters">
              {(
                [
                  ['30d', '近 30 天'],
                  ['year', '本年'],
                  ['all', '全部'],
                  ['custom', '自定义日期'],
                ] as const
              ).map(([id, label]) => (
                <button
                  className={`history-stat-filter${range === id ? ' active' : ''}`}
                  key={id}
                  onClick={() => chooseRange(id)}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="history-stat-metrics">
            <article className="history-stat-metric">
              <span>累计实际学习时长</span>
              <b>{snapshot.hours}</b>
              <small>来自 {snapshot.completedLessons} 节最终完成课节</small>
            </article>
            <article className="history-stat-metric">
              <span>已完成课节</span>
              <b>{snapshot.completedLessons}</b>
              <small>分布在 {snapshot.courseCount} 门正式课程</small>
            </article>
            <article className="history-stat-metric">
              <span>已关闭课程</span>
              <b>{snapshot.closedCourses}</b>
              <small>
                {snapshot.abandonedCourseCount === 0
                  ? '无已放弃课节'
                  : `其中 ${snapshot.abandonedCourseCount} 门含已放弃课节`}
              </small>
            </article>
            <article className="history-stat-metric">
              <span>活跃学习日</span>
              <b>{snapshot.activeDays} 天</b>
              <small>
                当前连续 {snapshot.currentStreakDays} 天 · 最长 {snapshot.longestStreakDays} 天
              </small>
            </article>
          </div>
          <div className="history-stat-grid-2">
            <article className="history-stat-panel">
              <div className="history-stat-panel-head">
                <div>
                  <h3>实际学习时长趋势</h3>
                  <p>按周汇总 · 单位：分钟</p>
                </div>
                <small>过去 12 周</small>
              </div>
              <div aria-label="过去十二周实际学习时长" className="history-stat-chart">
                {snapshot.weeklyTrend.map((week, index) => {
                  const tooltipId = `history-stat-week-tooltip-${index}`;
                  const isVisible = visibleWeek === index;
                  const duration =
                    week.durationMinutes < 60
                      ? `${week.durationMinutes} 分钟`
                      : `${Math.floor(week.durationMinutes / 60)} 小时${
                          week.durationMinutes % 60 === 0
                            ? ''
                            : ` ${week.durationMinutes % 60} 分钟`
                        }`;
                  const accessibleLabel = `第 ${index + 1} 周，${week.startDate} 至 ${
                    week.endDate
                  }，学习 ${duration}，完成 ${week.lessonCount} 节课`;
                  return (
                    <button
                      aria-describedby={isVisible ? tooltipId : undefined}
                      aria-label={accessibleLabel}
                      aria-pressed={pinnedWeek === index}
                      className={`history-stat-bar-day${pinnedWeek === index ? ' pinned' : ''}`}
                      key={index}
                      onBlur={() => setFocusedWeek(undefined)}
                      onClick={() =>
                        setPinnedWeek((current) => (current === index ? undefined : index))
                      }
                      onFocus={() => setFocusedWeek(index)}
                      onMouseEnter={() => setHoveredWeek(index)}
                      onMouseLeave={() => setHoveredWeek(undefined)}
                      style={{ '--h': `${week.height}%` } as React.CSSProperties}
                      type="button"
                    >
                      <i aria-hidden="true" />
                      <span>{index + 1}周</span>
                      {isVisible ? (
                        <span className="history-stat-week-tooltip" id={tooltipId} role="tooltip">
                          <b>
                            {week.startDate} – {week.endDate}
                          </b>
                          <span>学习时长：{duration}</span>
                          <span>课节数量：{week.lessonCount} 节</span>
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </article>
            <div className="history-stat-stack">
              <article className="history-stat-panel">
                <div className="history-stat-panel-head">
                  <div>
                    <h3>学科投入</h3>
                    <p>按实际学习时长排序</p>
                  </div>
                </div>
                <div className="history-stat-rank-list" id="history-stat-discipline-list">
                  {visibleDisciplines.map((item) => (
                    <div className="history-stat-rank" key={item.label}>
                      <b>{item.label}</b>
                      <div className="history-stat-track">
                        <i style={{ '--w': `${item.percent}%` } as React.CSSProperties} />
                      </div>
                      <span>{item.hours}</span>
                    </div>
                  ))}
                </div>
                {hasHiddenDisciplines ? (
                  <button
                    aria-controls="history-stat-discipline-list"
                    aria-expanded={showAllDisciplines}
                    className="history-stat-discipline-toggle"
                    onClick={() => setShowAllDisciplines((current) => !current)}
                    type="button"
                  >
                    {showAllDisciplines ? '收起' : `查看全部 ${snapshot.disciplines.length} 个学科`}
                  </button>
                ) : null}
              </article>
            </div>
          </div>
          <article className="history-stat-panel history-stat-course-panel">
            <div className="history-stat-panel-head">
              <div>
                <h3>历史课程</h3>
                <p>
                  <span>{visibleCourses.length} 门课程</span>
                </p>
              </div>
              <div className="history-stat-course-tools">
                <label>
                  <span>课程状态</span>
                  <select
                    aria-label="课程状态"
                    value={status}
                    onChange={(event) => setStatus(event.target.value)}
                  >
                    <option value="">全部状态</option>
                    <option>学习中</option>
                    <option>已关闭</option>
                  </select>
                </label>
                <label>
                  <span>学科 / 领域</span>
                  <select
                    aria-label="学科 / 领域"
                    value={domain}
                    onChange={(event) => setDomain(event.target.value)}
                  >
                    <option value="">全部领域</option>
                    {domains.map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>来源模式</span>
                  <select
                    aria-label="来源模式"
                    value={mode}
                    onChange={(event) => setMode(event.target.value)}
                  >
                    <option value="">全部模式</option>
                    {modes.map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>排序</span>
                  <select
                    aria-label="排序"
                    value={sort}
                    onChange={(event) => setSort(event.target.value as typeof sort)}
                  >
                    <option value="recent">最近完成</option>
                    <option value="oldest">最早完成</option>
                    <option value="duration">完成时长最多</option>
                  </select>
                </label>
              </div>
            </div>
            {props.catalogError === undefined ? (
              <table className="history-stat-course-table">
                <thead>
                  <tr>
                    <th>课程</th>
                    <th>状态</th>
                    <th>来源模式</th>
                    <th>课节处置</th>
                    <th>学习时长</th>
                    <th>最近完成</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {visibleCourses.map((course) => (
                    <tr key={course.courseId}>
                      <td className="history-stat-course-name">
                        <b>{course.title}</b>
                        <span>
                          {course.domain} · {course.topics}
                        </span>
                      </td>
                      <td>
                        <span
                          className={`history-stat-badge${course.status === '已关闭' ? ' closed' : ''}`}
                        >
                          {course.status}
                        </span>
                      </td>
                      <td>{course.mode}</td>
                      <td>{course.disposition}</td>
                      <td>{course.duration}</td>
                      <td>{course.recentDate}</td>
                      <td>
                        <button
                          className="lm-btn"
                          onClick={() => props.onOpenCourse(course)}
                          type="button"
                        >
                          {course.reviewAvailable ? '查看主题总结' : '查看课程档案'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="history-stat-catalog-error" role="alert">
                <strong>课程目录暂不可用</strong>
                <p>统计数据仍可查看，课程列表可稍后重试。</p>
              </div>
            )}
          </article>
        </section>
      </section>
      <dialog className="history-stat-range-dialog" ref={dialog}>
        <header>
          <h2>选择统计日期</h2>
        </header>
        <div className="history-stat-range-body">
          <label className="lm-field">
            <span>开始日期</span>
            <input
              className="lm-control"
              type="date"
              value={draftCustom.start}
              onChange={(event) =>
                setDraftCustom((value) => ({ ...value, start: event.target.value }))
              }
            />
          </label>
          <label className="lm-field">
            <span>结束日期</span>
            <input
              className="lm-control"
              type="date"
              value={draftCustom.end}
              onChange={(event) =>
                setDraftCustom((value) => ({ ...value, end: event.target.value }))
              }
            />
          </label>
          {rangeError === undefined ? null : (
            <p className="history-stat-range-error" role="alert">
              {rangeError}
            </p>
          )}
        </div>
        <footer>
          <button className="lm-btn" onClick={closeDialog} type="button">
            取消
          </button>
          <button className="lm-btn primary" onClick={applyCustomRange} type="button">
            应用日期
          </button>
        </footer>
      </dialog>
    </Page>
  );
}
