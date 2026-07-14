import { useMemo, useState } from 'react';

import type { HomeDashboardView } from '@learning-more/contracts';

import type { ScheduleItemView } from '../../client/planning-client.js';

import './planning-workspace.css';

type HomeCourse = HomeDashboardView['courses'][number];
type HomeLesson = HomeDashboardView['lessons'][number];

export type PlanningLessonMetadata = Readonly<{
  estimatedMinutes?: number;
  topic?: string;
  points?: readonly string[];
}>;

type PlanningEntry = Readonly<{
  course: HomeCourse | undefined;
  lesson: HomeLesson;
  schedule: ScheduleItemView | undefined;
  metadata: PlanningLessonMetadata;
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
  readonly onGeneratePlanFlow: () => void;
  readonly onReturn: () => void;
}) {
  const [selectedDate, setSelectedDate] = useState(props.anchorDate);
  const [statusFilter, setStatusFilter] = useState('');
  const [topicFilter, setTopicFilter] = useState('');
  const [scheduleTarget, setScheduleTarget] = useState<PlanningEntry>();
  const [draftDate, setDraftDate] = useState(props.anchorDate);
  const [previewTarget, setPreviewTarget] = useState<PlanningEntry>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const entries = useMemo<readonly PlanningEntry[]>(() => {
    const courseById = new Map(props.courses.map((course) => [course.courseId, course]));
    const scheduleByLesson = new Map(
      props.items
        .filter((item) => item.status === 'scheduled')
        .map((item) => [item.lessonId, item]),
    );
    return props.lessons
      .filter((lesson) => lesson.progress !== 'completed' && lesson.progress !== 'abandoned')
      .map((lesson) => ({
        course: courseById.get(lesson.courseId),
        lesson,
        schedule: scheduleByLesson.get(lesson.lessonId),
        metadata: props.metadata?.[lesson.lessonId] ?? {},
      }));
  }, [props.courses, props.items, props.lessons, props.metadata]);

  const dates = useMemo(() => sevenDates(props.anchorDate), [props.anchorDate]);
  const topics = [
    ...new Set(entries.map((entry) => entry.metadata.topic).filter(Boolean)),
  ] as string[];
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
      (topicFilter === '' || topicFilter === entry.metadata.topic)
    );
  });

  function openSchedule(entry: PlanningEntry) {
    setScheduleTarget(entry);
    setDraftDate(
      entry.schedule === undefined
        ? selectedDate || props.anchorDate
        : localDate(entry.schedule.startAt),
    );
    setError(undefined);
  }

  async function saveSchedule() {
    if (scheduleTarget === undefined) return;
    setBusy(true);
    setError(undefined);
    const minutes = scheduleTarget.metadata.estimatedMinutes ?? 45;
    const startAt = atLocalTime(draftDate, 19, 0);
    const endAt = new Date(Date.parse(startAt) + minutes * 60_000).toISOString();
    try {
      if (scheduleTarget.schedule === undefined) {
        await props.onCreate({
          courseId: scheduleTarget.lesson.courseId,
          lessonId: scheduleTarget.lesson.lessonId,
          startAt,
          endAt,
          timezoneAtCreation: Intl.DateTimeFormat().resolvedOptions().timeZone,
        });
      } else {
        await props.onMove(scheduleTarget.schedule, { startAt, endAt });
      }
      setSelectedDate(draftDate);
      setStatusFilter('');
      setTopicFilter('');
      setScheduleTarget(undefined);
    } catch {
      setError('排期版本已变化或日期未保存，请刷新后重试。');
    } finally {
      setBusy(false);
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
          <button className="lm-btn primary" type="button" onClick={props.onGeneratePlanFlow}>
            生成计划流
          </button>
          <button className="lm-btn" type="button" onClick={props.onReturn}>
            返回课程表
          </button>
        </div>
      </section>

      <div className="planner-layout">
        <aside className="lm-card planning-days" aria-label="今日起 7 天">
          <header>
            <b>今日起 7 天</b>
          </header>
          {dates.map((date) => {
            const titles = entries
              .filter(
                (entry) =>
                  entry.schedule !== undefined && localDate(entry.schedule.startAt) === date,
              )
              .map((entry) => entry.lesson.title);
            return (
              <button
                aria-pressed={selectedDate === date}
                className={`planning-day${selectedDate === date ? ' active' : ''}`}
                key={date}
                type="button"
                onClick={() => {
                  setSelectedDate(date);
                  setStatusFilter('');
                  setTopicFilter('');
                }}
              >
                <span className="planning-day-date">
                  <small>{weekdayLabel(date, props.anchorDate)}</small>
                  <b>{shortDate(date)}</b>
                </span>
                <span>{titles.join(' · ') || '暂无安排'}</span>
              </button>
            );
          })}
        </aside>

        <section className="lm-card planning-main">
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
              aria-label="主题标签"
              className="lm-control"
              value={topicFilter}
              onChange={(event) => {
                setSelectedDate('');
                setTopicFilter(event.target.value);
              }}
            >
              <option value="">全部主题标签</option>
              {topics.map((topic) => (
                <option key={topic}>{topic}</option>
              ))}
            </select>
            <button
              className="lm-btn"
              type="button"
              onClick={() => {
                setSelectedDate('');
                setStatusFilter('');
                setTopicFilter('');
              }}
            >
              清除筛选
            </button>
          </div>

          <div className="planning-lesson-list">
            {visibleEntries.map((entry) => {
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
                      {entry.metadata.topic === undefined ? null : (
                        <span className="lm-pill">{entry.metadata.topic}</span>
                      )}
                    </div>
                  </div>
                  <div className="planning-lesson-actions">
                    <button
                      className="planning-date-trigger"
                      type="button"
                      onClick={() => openSchedule(entry)}
                    >
                      {scheduledDate ?? '点击安排学习日期'}
                    </button>
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
          </div>
        </section>
      </div>

      {scheduleTarget === undefined ? null : (
        <div className="planning-dialog-backdrop" role="presentation">
          <section
            aria-labelledby="planning-date-title"
            aria-modal="true"
            className="planning-dialog"
            role="dialog"
          >
            <header>
              <div className="lm-kicker">学习日期</div>
              <h2 id="planning-date-title">{scheduleTarget.lesson.title}</h2>
            </header>
            <div className="planning-dialog-body">
              <label className="lm-field">
                <span>学习日期</span>
                <input
                  min={props.anchorDate}
                  type="date"
                  value={draftDate}
                  onChange={(event) => setDraftDate(event.target.value)}
                />
              </label>
              {error === undefined ? null : <p role="alert">{error}</p>}
            </div>
            <footer>
              <button className="lm-btn" type="button" onClick={() => setScheduleTarget(undefined)}>
                取消
              </button>
              <button
                className="lm-btn primary"
                disabled={busy}
                type="button"
                onClick={() => void saveSchedule()}
              >
                保存日期
              </button>
            </footer>
          </section>
        </div>
      )}

      {previewTarget === undefined ? null : (
        <div className="planning-dialog-backdrop" role="presentation">
          <section
            aria-labelledby="planning-preview-title"
            aria-modal="true"
            className="planning-dialog"
            role="dialog"
          >
            <header>
              <div className="lm-kicker">核心知识点</div>
              <h2 id="planning-preview-title">{previewTarget.lesson.title}</h2>
            </header>
            <div className="planning-dialog-body">
              {(previewTarget.metadata.points ?? ['学习目标', '关键判断', '应用练习']).map(
                (point) => (
                  <div className="planning-knowledge-point" key={point}>
                    <b>{point}</b>
                  </div>
                ),
              )}
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
