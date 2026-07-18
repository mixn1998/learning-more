import { useEffect, useMemo, useState } from 'react';

import type { HomeDashboardView } from '@learning-more/contracts';

import type { ScheduleItemView } from '../../client/planning-client.js';
import { toBroadDisciplineLabel } from '../../discipline-label.js';

import './planning-workspace.css';

type HomeCourse = HomeDashboardView['courses'][number];
type HomeLesson = HomeDashboardView['lessons'][number];

export type PlanningLessonMetadata = Readonly<{
  estimatedMinutes?: number;
  objective?: string;
  topic?: string;
  points?: readonly string[];
}>;

type ResolvedPlanningLessonMetadata = Readonly<{
  estimatedMinutes: number;
  objective: string | undefined;
  disciplineTag: string | undefined;
  topicTags: readonly string[];
  points: readonly string[] | undefined;
}>;

type PlanningEntry = Readonly<{
  course: HomeCourse | undefined;
  lesson: HomeLesson;
  schedule: ScheduleItemView | undefined;
  metadata: ResolvedPlanningLessonMetadata;
}>;

function localDate(instant: string): string {
  const date = new Date(instant);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function sevenDates(anchor: string): readonly string[] {
  const start = new Date(`${anchor}T12:00:00`);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  });
}

function shortDate(value: string): string {
  return value.slice(5).replace('-', '/');
}

function weekdayLabel(value: string, anchor: string): string {
  if (value === anchor) return '周日 · 今天';
  const labels = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return labels[new Date(`${value}T12:00:00`).getDay()] ?? '';
}

function atLocalTime(date: string, hour: number, minute: number): string {
  return new Date(
    `${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`,
  ).toISOString();
}

export function PlanningWorkspaceView(props: {
  readonly anchorDate: string;
  readonly courses: readonly HomeCourse[];
  readonly lessons: readonly HomeLesson[];
  readonly items: readonly ScheduleItemView[];
  readonly metadata?: Readonly<Record<string, PlanningLessonMetadata>>;
  readonly onCreate: (input: {
    courseId: string;
    lessonId: string;
    startAt: string;
    endAt: string;
    timezoneAtCreation: string;
  }) => Promise<void>;
  readonly onMove: (
    item: ScheduleItemView,
    draft: Readonly<{ startAt: string; endAt: string }>,
  ) => Promise<void>;
  readonly onRemove: (item: ScheduleItemView) => Promise<void>;
  readonly onClear: (scheduleItemIds: readonly string[]) => Promise<void>;
  readonly onGeneratePlanFlow: () => void;
  readonly onReturn: () => void;
}) {
  const [selectedDate, setSelectedDate] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [disciplineFilter, setDisciplineFilter] = useState('');
  const [previewTarget, setPreviewTarget] = useState<PlanningEntry>();
  const [pendingDates, setPendingDates] = useState<Readonly<Record<string, string>>>({});
  const [savingLessonIds, setSavingLessonIds] = useState<ReadonlySet<string>>(new Set());
  const [scheduleErrors, setScheduleErrors] = useState<Readonly<Record<string, string>>>({});
  const [clearingAll, setClearingAll] = useState(false);
  const [clearError, setClearError] = useState<string>();
  const [visibleLimit, setVisibleLimit] = useState(60);

  const entries = useMemo<readonly PlanningEntry[]>(() => {
    const courseById = new Map(props.courses.map((course) => [course.courseId, course]));
    const scheduleByLesson = new Map(
      props.items
        .filter((item) => item.status === 'scheduled')
        .map((item) => [item.lessonId, item]),
    );
    return props.lessons
      .filter((lesson) => lesson.progress !== 'completed' && lesson.progress !== 'abandoned')
      .map((lesson) => {
        const course = courseById.get(lesson.courseId);
        const fallbackTopic = props.metadata?.[lesson.lessonId]?.topic;
        return {
          course,
          lesson,
          schedule: scheduleByLesson.get(lesson.lessonId),
          metadata: {
            estimatedMinutes:
              props.metadata?.[lesson.lessonId]?.estimatedMinutes ?? lesson.estimatedMinutes ?? 45,
            objective: props.metadata?.[lesson.lessonId]?.objective ?? lesson.objective,
            disciplineTag: toBroadDisciplineLabel(course?.disciplineTag),
            topicTags: [
              ...new Set([
                ...(course?.topicTags ?? []),
                ...(fallbackTopic === undefined ? [] : [fallbackTopic]),
              ]),
            ],
            points: props.metadata?.[lesson.lessonId]?.points ?? lesson.coreKnowledgePoints,
          },
        };
      });
  }, [props.courses, props.items, props.lessons, props.metadata]);

  const dates = useMemo(() => sevenDates(props.anchorDate), [props.anchorDate]);
  const disciplines = [
    ...new Set(
      entries.flatMap((entry) =>
        entry.metadata.disciplineTag === undefined ? [] : [entry.metadata.disciplineTag],
      ),
    ),
  ];
  const visibleEntries = entries.filter((entry) => {
    const scheduledDate =
      entry.schedule === undefined ? undefined : localDate(entry.schedule.startAt);
    if (selectedDate !== '' && scheduledDate !== selectedDate) return false;
    const status =
      scheduledDate === undefined
        ? '待规划'
        : scheduledDate < props.anchorDate
          ? '已逾期'
          : '已安排';
    return (
      (statusFilter === '' || statusFilter === status) &&
      (disciplineFilter === '' || entry.metadata.disciplineTag === disciplineFilter)
    );
  });
  useEffect(() => {
    setVisibleLimit(60);
  }, [disciplineFilter, entries.length, selectedDate, statusFilter]);
  const renderedEntries = visibleEntries.slice(0, visibleLimit);

  async function saveSchedule(entry: PlanningEntry, date: string) {
    const lessonId = entry.lesson.lessonId;
    if (date === '' || savingLessonIds.has(lessonId)) return;
    setPendingDates((current) => ({ ...current, [lessonId]: date }));
    setSavingLessonIds((current) => new Set([...current, lessonId]));
    setScheduleErrors((current) => {
      const next = { ...current };
      delete next[lessonId];
      return next;
    });
    const minutes = entry.metadata.estimatedMinutes ?? 45;
    const startAt = atLocalTime(date, 19, 0);
    const endAt = new Date(Date.parse(startAt) + minutes * 60_000).toISOString();
    try {
      if (entry.schedule === undefined) {
        await props.onCreate({
          courseId: entry.lesson.courseId,
          lessonId,
          startAt,
          endAt,
          timezoneAtCreation: Intl.DateTimeFormat().resolvedOptions().timeZone,
        });
      } else {
        await props.onMove(entry.schedule, { startAt, endAt });
      }
      setStatusFilter('');
      setDisciplineFilter('');
    } catch {
      setScheduleErrors((current) => ({
        ...current,
        [lessonId]: '排期版本已变化或日期未保存，请刷新后重试。',
      }));
    } finally {
      setPendingDates((current) => {
        const next = { ...current };
        delete next[lessonId];
        return next;
      });
      setSavingLessonIds((current) => {
        const next = new Set(current);
        next.delete(lessonId);
        return next;
      });
    }
  }

  const visibleScheduleItemIds = visibleEntries.flatMap((entry) =>
    entry.schedule === undefined ? [] : [entry.schedule.id],
  );

  async function clearVisibleSchedules() {
    if (clearingAll || !window.confirm('清空当前筛选结果中的排期')) {
      return;
    }
    setClearingAll(true);
    setClearError(undefined);
    try {
      await props.onClear(visibleScheduleItemIds);
    } catch {
      setClearError('清空失败，排期版本可能已经变化，请重试。');
    } finally {
      setClearingAll(false);
    }
  }

  return (
    <main className="lm-page planning-workspace">
      <section className="lm-card planning-hero">
        <div>
          <div className="lm-kicker">COURSE PLANNING</div>
          <h1>安排课节学习日期</h1>
        </div>
        <div className="lm-actions">
          <button
            className="lm-btn"
            disabled={
              clearingAll || savingLessonIds.size > 0 || visibleScheduleItemIds.length === 0
            }
            type="button"
            onClick={() => void clearVisibleSchedules()}
          >
            {clearingAll ? '正在清空…' : '清空当前筛选结果中的排期'}
          </button>
          <button
            className="lm-btn primary"
            disabled={savingLessonIds.size > 0}
            type="button"
            onClick={props.onGeneratePlanFlow}
          >
            生成计划流
          </button>
          <button className="lm-btn" type="button" onClick={props.onReturn}>
            返回课程表
          </button>
        </div>
      </section>
      {clearError === undefined ? null : (
        <p className="pf-note" role="alert">
          {clearError}
        </p>
      )}

      <div className="planner-layout week-workspace-layout">
        <aside className="lm-card planning-days week-workspace-rail" aria-label="今日起 7 天">
          <header>
            <b>今日起 7 天</b>
          </header>
          {dates.map((date) => {
            const dateEntries = entries.filter(
              (entry) => entry.schedule !== undefined && localDate(entry.schedule.startAt) === date,
            );
            return (
              <button
                aria-pressed={selectedDate === date}
                className={`planning-day${selectedDate === date ? ' active' : ''}`}
                key={date}
                type="button"
                onClick={() => {
                  setSelectedDate(date);
                  setStatusFilter('');
                  setDisciplineFilter('');
                }}
              >
                <span className="planning-day-date">
                  <small>{weekdayLabel(date, props.anchorDate)}</small>
                  <b>{shortDate(date)}</b>
                </span>
                {dateEntries.length === 0 ? (
                  <span className="week-course-empty">暂无安排</span>
                ) : (
                  <span className="week-course-list" role="list">
                    {dateEntries.map((entry) => (
                      <span
                        className="week-course-item"
                        key={entry.lesson.lessonId}
                        role="listitem"
                      >
                        {entry.lesson.title}
                      </span>
                    ))}
                  </span>
                )}
              </button>
            );
          })}
        </aside>

        <section className="lm-card planning-main week-workspace-main">
          <header className="planning-main-head">
            <div>
              <h2>待规划与已安排课节</h2>
              <p>
                {selectedDate || '当前筛选'} · {visibleEntries.length} 节
              </p>
            </div>
          </header>
          <div className="planning-filters">
            <select
              aria-label="排期状态"
              className="lm-control"
              value={statusFilter}
              onChange={(event) => {
                setSelectedDate('');
                setStatusFilter(event.target.value);
              }}
            >
              <option value="">全部排期状态</option>
              <option value="待规划">待规划</option>
              <option value="已安排">已安排</option>
              <option value="已逾期">已逾期</option>
            </select>
            <select
              aria-label="学科/领域"
              className="lm-control"
              value={disciplineFilter}
              onChange={(event) => {
                setSelectedDate('');
                setDisciplineFilter(event.target.value);
              }}
            >
              <option value="">全部学科/领域</option>
              {disciplines.map((discipline) => (
                <option key={discipline}>{discipline}</option>
              ))}
            </select>
            <button
              className="lm-btn"
              type="button"
              onClick={() => {
                setSelectedDate('');
                setStatusFilter('');
                setDisciplineFilter('');
              }}
            >
              清除筛选
            </button>
          </div>

          <div className="planning-lesson-list">
            {renderedEntries.map((entry) => {
              const scheduledDate =
                entry.schedule === undefined ? undefined : localDate(entry.schedule.startAt);
              const status =
                scheduledDate === undefined
                  ? '待规划'
                  : scheduledDate < props.anchorDate
                    ? '已逾期'
                    : '已安排';
              return (
                <article
                  className={`planning-lesson${status === '已安排' ? ' planned' : ''}${status === '已逾期' ? ' overdue' : ''}`}
                  data-course-id={entry.lesson.courseId}
                  data-lesson-id={entry.lesson.lessonId}
                  key={entry.lesson.lessonId}
                >
                  <div className="planning-lesson-copy">
                    <h3>{entry.lesson.title}</h3>
                    <div className="planning-lesson-meta">
                      <span>《{entry.course?.title ?? entry.lesson.courseId}》</span>
                      <span>预计 {entry.metadata.estimatedMinutes ?? 45} 分钟</span>
                      <span className={`lm-pill${status === '已逾期' ? ' schedule-overdue' : ''}`}>
                        {status}
                      </span>
                      {entry.metadata.topicTags[0] === undefined ? null : (
                        <span className="lm-pill">{entry.metadata.topicTags[0]}</span>
                      )}
                    </div>
                  </div>
                  <div className="planning-lesson-actions">
                    <div className="planning-date-field">
                      <label className="sr-only" htmlFor={`planning-date-${entry.lesson.lessonId}`}>
                        安排学习日期：{entry.lesson.title}
                      </label>
                      <input
                        aria-describedby={
                          scheduleErrors[entry.lesson.lessonId] === undefined
                            ? undefined
                            : `planning-date-error-${entry.lesson.lessonId}`
                        }
                        className="planning-date-input"
                        disabled={savingLessonIds.has(entry.lesson.lessonId)}
                        id={`planning-date-${entry.lesson.lessonId}`}
                        min={props.anchorDate}
                        type="date"
                        value={pendingDates[entry.lesson.lessonId] ?? scheduledDate ?? ''}
                        onChange={(event) => void saveSchedule(entry, event.currentTarget.value)}
                      />
                      {scheduleErrors[entry.lesson.lessonId] === undefined ? null : (
                        <small id={`planning-date-error-${entry.lesson.lessonId}`} role="alert">
                          {scheduleErrors[entry.lesson.lessonId]}
                        </small>
                      )}
                    </div>
                    {entry.schedule === undefined ? null : (
                      <button
                        className="lm-btn"
                        type="button"
                        onClick={() => void props.onRemove(entry.schedule!)}
                      >
                        取消排期
                      </button>
                    )}
                    <button
                      className="lm-btn"
                      type="button"
                      onClick={() => setPreviewTarget(entry)}
                    >
                      预览
                    </button>
                  </div>
                </article>
              );
            })}
            {renderedEntries.length < visibleEntries.length ? (
              <button
                className="lm-btn planning-load-more"
                type="button"
                onClick={() => setVisibleLimit((current) => current + 60)}
              >
                显示更多（剩余 {visibleEntries.length - renderedEntries.length} 节）
              </button>
            ) : null}
          </div>
        </section>
      </div>

      {previewTarget === undefined ? null : (
        <div className="planning-dialog-backdrop" role="presentation">
          <section
            aria-labelledby="planning-preview-title"
            aria-modal="true"
            className="planning-dialog"
            role="dialog"
          >
            <header>
              <div className="lm-kicker">课节内容</div>
              <h2 id="planning-preview-title">{previewTarget.lesson.title}</h2>
            </header>
            <div className="planning-dialog-body">
              <div className="planning-knowledge-point">
                <b>学习目标</b>
                <p>{previewTarget.metadata.objective ?? '课程导航暂未提供学习目标。'}</p>
              </div>
              <div className="planning-knowledge-point">
                <b>核心知识点</b>
                {previewTarget.metadata.points?.length ? (
                  <ul>
                    {previewTarget.metadata.points.map((point) => (
                      <li key={point}>{point}</li>
                    ))}
                  </ul>
                ) : (
                  <p>课程导航暂未提供核心知识点。</p>
                )}
              </div>
              <div className="planning-knowledge-point planning-duration-point">
                <b>预计学习时间</b>
                <span>{previewTarget.metadata.estimatedMinutes ?? 45} 分钟</span>
              </div>
            </div>
            <footer>
              <button className="lm-btn" type="button" onClick={() => setPreviewTarget(undefined)}>
                关闭
              </button>
            </footer>
          </section>
        </div>
      )}
    </main>
  );
}
