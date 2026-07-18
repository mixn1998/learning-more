import { useMemo, useState } from 'react';

import { ApplicationProblemSchema, type HomeDashboardView } from '@learning-more/contracts';

import type { PlanFlowAction, PlanFlowPreviewView } from '../../client/planning-client.js';

import './planning-workspace.css';

const steps = ['学习节奏', '选择课程', '排期策略', '预览确认'] as const;
const weekdays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const;

type HomeCourse = HomeDashboardView['courses'][number];
type HomeLesson = HomeDashboardView['lessons'][number];
type PlanSuggestion = PlanFlowPreviewView['suggestions'][number];

type PreviewLesson = Readonly<{
  courseTitle: string;
  durationMinutes: number;
  lessonId: string;
  lessonTitle: string;
}>;

type PreviewDay = Readonly<{
  dateKey: string;
  dayLabel: string;
  lessons: readonly PreviewLesson[];
  totalMinutes: number;
}>;

type PreviewWeek = Readonly<{
  dateRange: string;
  days: readonly PreviewDay[];
  key: string;
}>;

function suggestionDateKey(suggestion: PlanSuggestion): string {
  return new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone: suggestion.timezoneAtCreation,
    year: 'numeric',
  }).format(new Date(suggestion.startAt));
}

function shortDate(dateKey: string): string {
  return dateKey.slice(5).replace('-', '/');
}

function weekKey(dateKey: string): string {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - weekday + 1);
  return date.toISOString().slice(0, 10);
}

function buildPreviewWeeks(
  suggestions: readonly PlanSuggestion[],
  courses: readonly HomeCourse[],
  lessons: readonly HomeLesson[],
): readonly PreviewWeek[] {
  const courseById = new Map(courses.map((course) => [course.courseId, course]));
  const lessonById = new Map(lessons.map((lesson) => [lesson.lessonId, lesson]));
  const days = new Map<string, PreviewDay>();

  for (const suggestion of [...suggestions].sort(
    (left, right) => Date.parse(left.startAt) - Date.parse(right.startAt),
  )) {
    const dateKey = suggestionDateKey(suggestion);
    const durationMinutes = Math.max(
      0,
      Math.round((Date.parse(suggestion.endAt) - Date.parse(suggestion.startAt)) / 60_000),
    );
    const current = days.get(dateKey);
    const previewLesson: PreviewLesson = {
      courseTitle: courseById.get(suggestion.courseId)?.title ?? suggestion.courseId,
      durationMinutes,
      lessonId: suggestion.lessonId,
      lessonTitle: lessonById.get(suggestion.lessonId)?.title ?? suggestion.lessonId,
    };
    if (current === undefined) {
      days.set(dateKey, {
        dateKey,
        dayLabel: new Intl.DateTimeFormat('zh-CN', {
          timeZone: suggestion.timezoneAtCreation,
          weekday: 'short',
        }).format(new Date(suggestion.startAt)),
        lessons: [previewLesson],
        totalMinutes: durationMinutes,
      });
    } else {
      days.set(dateKey, {
        ...current,
        lessons: [...current.lessons, previewLesson],
        totalMinutes: current.totalMinutes + durationMinutes,
      });
    }
  }

  const weeks = new Map<string, PreviewDay[]>();
  for (const day of days.values()) {
    const key = weekKey(day.dateKey);
    weeks.set(key, [...(weeks.get(key) ?? []), day]);
  }

  return [...weeks.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, weekDays]) => ({
      dateRange: `${shortDate(weekDays[0]!.dateKey)} — ${shortDate(weekDays.at(-1)!.dateKey)}`,
      days: weekDays,
      key,
    }));
}

export type PlanFlowWizardInput = Readonly<{
  courseIds: readonly string[];
  lessonIds: readonly string[];
  startDate: string;
  dailyTargetMinutes: number;
  learningDays: readonly string[];
  preserveExistingDates: boolean;
  rescheduleOverdue: boolean;
  strategy: 'balanced' | 'focus' | 'priority';
}>;

function tomorrow(): string {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function strategyLabel(value: PlanFlowWizardInput['strategy']): string {
  return value === 'balanced' ? '均衡推进' : value === 'focus' ? '专注完成' : '按优先级';
}

function weeklyEstimate(minutes: number, days: number): string {
  const total = minutes * days;
  const hours = Math.floor(total / 60);
  const remainder = total % 60;
  return `预计每周 ${hours} 小时${remainder === 0 ? '' : ` ${remainder} 分钟`}`;
}

function previewFailureMessage(errorCode?: string): string {
  if (errorCode === 'plan_preview_invalid') {
    return '当前日期、学习日或课节依赖无法形成有效排期，请调整约束后重试。';
  }
  return '计划预览计算失败，输入约束已保留。';
}

function courseStats(course: HomeCourse, lessons: readonly HomeLesson[]) {
  const related = lessons.filter((lesson) => lesson.courseId === course.courseId);
  const remaining = related.filter(
    (lesson) => lesson.progress !== 'completed' && lesson.progress !== 'abandoned',
  );
  const completed = related.filter((lesson) => lesson.progress === 'completed').length;
  const progress = related.length === 0 ? 0 : Math.round((completed / related.length) * 100);
  return { related, remaining, progress };
}

export function PlanFlowPanel(props: {
  readonly courses?: readonly HomeCourse[];
  readonly lessons?: readonly HomeLesson[];
  readonly initialCourseIds?: readonly string[];
  readonly initialStartDate?: string;
  readonly fullFrame?: boolean;
  readonly onClose?: () => void;
  readonly onPreview: (input: PlanFlowWizardInput) => Promise<PlanFlowPreviewView>;
  readonly onConfirm: (flow: PlanFlowPreviewView) => Promise<PlanFlowPreviewView>;
  readonly onManage: (
    flow: PlanFlowPreviewView,
    action: PlanFlowAction,
  ) => Promise<PlanFlowPreviewView>;
}) {
  const courses = props.courses ?? [];
  const lessons = props.lessons ?? [];
  const initialSelected =
    props.initialCourseIds ??
    courses
      .filter((course) => course.status === 'active')
      .slice(0, 2)
      .map((course) => course.courseId);
  const [step, setStep] = useState(0);
  const [startDate, setStartDate] = useState(props.initialStartDate ?? tomorrow());
  const [dailyTargetMinutes, setDailyTargetMinutes] = useState(45);
  const [learningDays, setLearningDays] = useState<readonly string[]>(weekdays.slice(0, 5));
  const [preserveExistingDates, setPreserveExistingDates] = useState(true);
  const [rescheduleOverdue, setRescheduleOverdue] = useState(false);
  const [selectedCourseIds, setSelectedCourseIds] = useState<readonly string[]>(initialSelected);
  const [strategy, setStrategy] = useState<PlanFlowWizardInput['strategy']>('balanced');
  const [preview, setPreview] = useState<PlanFlowPreviewView>();
  const [previewInputKey, setPreviewInputKey] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const selectedLessonIds = useMemo(
    () =>
      lessons
        .filter(
          (lesson) =>
            selectedCourseIds.includes(lesson.courseId) &&
            lesson.progress !== 'completed' &&
            lesson.progress !== 'abandoned',
        )
        .map((lesson) => lesson.lessonId),
    [lessons, selectedCourseIds],
  );
  const previewWeeks = useMemo(
    () => (preview === undefined ? [] : buildPreviewWeeks(preview.suggestions, courses, lessons)),
    [courses, lessons, preview],
  );
  const previewTotalMinutes = useMemo(
    () =>
      previewWeeks.reduce(
        (weekTotal, week) =>
          weekTotal + week.days.reduce((dayTotal, day) => dayTotal + day.totalMinutes, 0),
        0,
      ),
    [previewWeeks],
  );
  const previewCompletionDate = previewWeeks.at(-1)?.days.at(-1)?.dateKey;
  const currentInput = useMemo<PlanFlowWizardInput>(
    () => ({
      courseIds: selectedCourseIds,
      lessonIds: selectedLessonIds,
      startDate,
      dailyTargetMinutes,
      learningDays,
      preserveExistingDates,
      rescheduleOverdue,
      strategy,
    }),
    [
      dailyTargetMinutes,
      learningDays,
      preserveExistingDates,
      rescheduleOverdue,
      selectedCourseIds,
      selectedLessonIds,
      startDate,
      strategy,
    ],
  );
  const currentInputKey = useMemo(() => JSON.stringify(currentInput), [currentInput]);
  const previewIsStale =
    preview !== undefined && preview.state !== 'confirmed' && previewInputKey !== currentInputKey;

  function toggleLearningDay(day: string) {
    setLearningDays((current) =>
      current.includes(day) ? current.filter((candidate) => candidate !== day) : [...current, day],
    );
  }

  function toggleCourse(courseId: string, disabled: boolean) {
    if (disabled) return;
    setSelectedCourseIds((current) =>
      current.includes(courseId)
        ? current.filter((candidate) => candidate !== courseId)
        : [...current, courseId],
    );
  }

  function validateStep(): boolean {
    if (step === 0 && (dailyTargetMinutes < 15 || learningDays.length === 0)) {
      setError('每日目标至少 15 分钟，并至少选择一个学习日。');
      return false;
    }
    if (step === 1 && selectedCourseIds.length === 0) {
      setError('至少选择一门仍有未完成课节的正式课程。');
      return false;
    }
    if (step >= 1 && selectedLessonIds.length === 0) {
      setError('所选课程没有可进入计划流的未完成课节。');
      return false;
    }
    setError(undefined);
    return true;
  }

  async function generatePreview() {
    if (!validateStep()) return;
    const requestedInput = currentInput;
    const requestedInputKey = currentInputKey;
    setBusy(true);
    setError(undefined);
    try {
      const result = await props.onPreview(requestedInput);
      if (result.state === 'failed') {
        setPreview(undefined);
        setPreviewInputKey(undefined);
        setError(previewFailureMessage(result.errorCode));
      } else {
        setPreview(result);
        setPreviewInputKey(requestedInputKey);
      }
    } catch {
      setError('计划预览计算失败，输入约束已保留。');
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (preview === undefined || previewIsStale) return;
    setBusy(true);
    setError(undefined);
    try {
      setPreview(await props.onConfirm(preview));
    } catch {
      setPreviewInputKey(undefined);
      setError('排期版本已变化，请重新预览。');
    } finally {
      setBusy(false);
    }
  }

  async function manage(action: PlanFlowAction) {
    if (preview === undefined) return;
    if (
      action === 'undo' &&
      !window.confirm(
        '仅撤回该计划流最近一次自动排期，不会修改手动排期；如恢复排期与后续手动修改冲突，系统将拒绝撤回。确定继续吗？',
      )
    ) {
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      setPreview(await props.onManage(preview, action));
    } catch (caught) {
      const problem = ApplicationProblemSchema.safeParse(caught);
      setError(
        problem.success && problem.data.code === 'plan_flow_undo_conflict'
          ? '无法撤回：计划流排期在上次操作后已被手动修改，或恢复日期与现有排期冲突。未修改任何排期。'
          : problem.success && problem.data.code === 'plan_flow_nothing_to_undo'
            ? '当前没有可撤回的计划流排期操作。'
            : '计划流状态已变化，请刷新后重试。',
      );
    } finally {
      setBusy(false);
    }
  }

  const wizard = (
    <div className="pf-stage">
      <div aria-hidden="true" className="pf-planner-bg">
        <div className="pf-ghost">
          {Array.from({ length: 4 }, (_, index) => (
            <div className="pf-ghost-row" key={index} />
          ))}
        </div>
        <div className="pf-ghost">
          {Array.from({ length: 3 }, (_, index) => (
            <div className="pf-ghost-row" key={index} />
          ))}
        </div>
      </div>
      <div aria-hidden="true" className="pf-backdrop" />
      <section
        aria-labelledby="plan-flow-title"
        aria-modal="true"
        className="pf-dialog"
        role="dialog"
      >
        <header className="pf-dialog-head">
          <div>
            <div className="pf-kicker">课程规划 · 自动排期</div>
            <h3 id="plan-flow-title">生成计划流</h3>
          </div>
          <button aria-label="关闭" className="pf-close" type="button" onClick={props.onClose}>
            ×
          </button>
        </header>

        <nav className="pf-steps" aria-label="计划流步骤">
          {steps.map((label, index) => (
            <button
              aria-current={step === index ? 'step' : undefined}
              className={`pf-step${step === index ? ' active' : ''}${step > index ? ' done' : ''}`}
              key={label}
              type="button"
              onClick={() => {
                if (index <= step || preview !== undefined) setStep(index);
              }}
            >
              <span className="pf-step-index">{index + 1}</span>
              <strong>{label}</strong>
            </button>
          ))}
        </nav>

        <main className="pf-body">
          {step === 0 ? (
            <section className="pf-panel active">
              <div className="pf-section-title">
                <div>
                  <h4>设置学习节奏</h4>
                </div>
                <span className="pf-mini-summary">
                  {weeklyEstimate(dailyTargetMinutes, learningDays.length)}
                </span>
              </div>
              <div className="pf-basic-grid">
                <div className="pf-field">
                  <label htmlFor="pf-start-date">开始日期</label>
                  <input
                    id="pf-start-date"
                    className="pf-control"
                    type="date"
                    value={startDate}
                    onChange={(event) => setStartDate(event.target.value)}
                  />
                </div>
                <div className="pf-field">
                  <label htmlFor="pf-daily-target">每日目标时长</label>
                  <input
                    aria-describedby={error === undefined ? undefined : 'pf-field-error'}
                    className="pf-control"
                    id="pf-daily-target"
                    inputMode="numeric"
                    min={15}
                    step={15}
                    type="number"
                    value={dailyTargetMinutes}
                    onChange={(event) => setDailyTargetMinutes(Number(event.target.value))}
                  />
                  {error === undefined ? null : (
                    <span className="pf-field-error" id="pf-field-error" role="alert">
                      {error}
                    </span>
                  )}
                </div>
              </div>
              <div className="pf-subsection">
                <div className="pf-subsection-head">
                  <strong>学习日</strong>
                </div>
                <div className="pf-weekdays">
                  {weekdays.map((day) => (
                    <button
                      aria-pressed={learningDays.includes(day)}
                      className={`pf-weekday${learningDays.includes(day) ? ' selected' : ''}`}
                      key={day}
                      type="button"
                      onClick={() => toggleLearningDay(day)}
                    >
                      {day}
                    </button>
                  ))}
                </div>
              </div>
              <div className="pf-policy-grid">
                <button
                  aria-pressed={preserveExistingDates}
                  className={`pf-policy${preserveExistingDates ? ' on' : ''}`}
                  type="button"
                  onClick={() => setPreserveExistingDates((current) => !current)}
                >
                  <span aria-hidden="true" className="pf-switch" />
                  <div>
                    <strong>保留已有日期</strong>
                    <span>未来已排课节和手动锁定课节保持原位。该规则默认开启。</span>
                  </div>
                </button>
                <button
                  aria-pressed={rescheduleOverdue}
                  className={`pf-policy${rescheduleOverdue ? ' on' : ''}`}
                  type="button"
                  onClick={() => setRescheduleOverdue((current) => !current)}
                >
                  <span aria-hidden="true" className="pf-switch" />
                  <div>
                    <strong>重新安排逾期课节</strong>
                    <span>开启后，逾期且未完成的课节会进入预览，并明确标记改期。</span>
                  </div>
                </button>
              </div>
            </section>
          ) : null}

          {step === 1 ? (
            <section className="pf-panel active">
              <div className="pf-section-title">
                <div>
                  <h4>选择加入计划流的课程</h4>
                  <p>只显示仍有未完成课节的正式课程。至少选择一门。</p>
                </div>
                <span className="pf-mini-summary">
                  已选 {selectedCourseIds.length} 门 · {selectedLessonIds.length} 节
                </span>
              </div>
              <div className="pf-course-grid">
                {courses.map((course) => {
                  const stats = courseStats(course, lessons);
                  const disabled = course.status === 'closed' || stats.remaining.length === 0;
                  const selected = selectedCourseIds.includes(course.courseId) && !disabled;
                  return (
                    <button
                      aria-pressed={selected}
                      className={`pf-course${selected ? ' selected' : ''}${disabled ? ' disabled' : ''}`}
                      data-course-id={course.courseId}
                      disabled={disabled}
                      key={course.courseId}
                      type="button"
                      onClick={() => toggleCourse(course.courseId, disabled)}
                    >
                      <span className="pf-check">{selected ? '✓' : ''}</span>
                      <h5>{course.title}</h5>
                      <p>
                        {disabled
                          ? '课程已全部完成，不再进入新的计划流。'
                          : '继续安排尚未完成的正式课节。'}
                      </p>
                      <div className="pf-tags">
                        <span className="pf-tag">正式课程</span>
                        <span className="pf-tag">
                          {course.status === 'active' ? '进行中' : '已关闭'}
                        </span>
                      </div>
                      <div className="pf-course-stats">
                        <span>
                          剩余课节<b>{stats.remaining.length}</b>
                        </span>
                        <span>
                          预计时长<b>{stats.remaining.length * 45} min</b>
                        </span>
                        <span>
                          当前进度<b>{stats.progress}%</b>
                        </span>
                      </div>
                      <div className="pf-progress">
                        <i style={{ width: `${stats.progress}%` }} />
                      </div>
                    </button>
                  );
                })}
              </div>
              {error === undefined ? null : (
                <p className="pf-note" role="alert">
                  {error}
                </p>
              )}
            </section>
          ) : null}

          {step === 2 ? (
            <section className="pf-panel active">
              <div className="pf-section-title">
                <div>
                  <h4>选择推进方式</h4>
                  <p>策略只影响课程之间如何交错，不改变每门课程内部的课节顺序。</p>
                </div>
                <span className="pf-mini-summary">当前：{strategyLabel(strategy)}</span>
              </div>
              <div className="pf-strategies">
                {(
                  [
                    [
                      'balanced',
                      '↔',
                      '均衡推进',
                      '在所选课程之间轮换安排，让多个方向保持连续进展，并优先填充每日剩余容量。',
                      '适合：同时维持多个学习方向',
                    ],
                    [
                      'focus',
                      '→',
                      '专注完成',
                      '先按顺序完成一门课程，再进入下一门，减少上下文切换。',
                      '适合：希望尽快完成一个完整主题',
                    ],
                    [
                      'priority',
                      '↑',
                      '按优先级',
                      '按课程选择顺序推进，优先满足主目标和截止日期。',
                      '适合：存在明确截止日期或主次目标',
                    ],
                  ] as const
                ).map(([id, mark, title, description, hint]) => (
                  <button
                    aria-pressed={strategy === id}
                    className={`pf-strategy${strategy === id ? ' selected' : ''}`}
                    key={id}
                    type="button"
                    onClick={() => setStrategy(id)}
                  >
                    <span className="pf-strategy-mark">{mark}</span>
                    <h5>{title}</h5>
                    <p>{description}</p>
                    <small>{hint}</small>
                  </button>
                ))}
              </div>
              <div className="pf-priority">
                课程顺序：
                {selectedCourseIds
                  .map(
                    (id, index) =>
                      `${index + 1}. ${courses.find((course) => course.courseId === id)?.title ?? id}`,
                  )
                  .join('　')}
              </div>
            </section>
          ) : null}

          {step === 3 ? (
            <section className="pf-panel active">
              <div className="pf-section-title">
                <div>
                  <h4>确认排期预览</h4>
                </div>
                <span className="pf-mini-summary">
                  {strategyLabel(strategy)} · {learningDays.length} 个学习日
                </span>
              </div>
              <div className="pf-summary-grid">
                <div className="pf-summary">
                  <span>开始日期</span>
                  <b>{startDate.slice(5).replace('-', '/')}</b>
                </div>
                <div className="pf-summary">
                  <span>预计完成</span>
                  <b>
                    {previewCompletionDate === undefined ? '—' : shortDate(previewCompletionDate)}
                  </b>
                </div>
                <div className="pf-summary">
                  <span>待排课节</span>
                  <b>{selectedLessonIds.length} 节</b>
                </div>
                <div className="pf-summary">
                  <span>预计总时长</span>
                  <b>{preview === undefined ? '—' : `${previewTotalMinutes} min`}</b>
                </div>
              </div>
              {preview === undefined ? (
                <div className="pf-note">生成预览不会修改正式排期；确认后才会写入版本化日程。</div>
              ) : (
                <>
                  <div className="pf-preview">
                    {previewWeeks.map((week, weekIndex) => (
                      <section className="pf-preview-week" key={week.key}>
                        <header className="pf-preview-week-head">
                          <h5>{`第 ${weekIndex + 1} 周`}</h5>
                          <span>{`${week.dateRange} · ${week.days.length} 个学习日`}</span>
                        </header>
                        <div className="pf-preview-week-days">
                          {week.days.map((day) => (
                            <article
                              className={`pf-day${day.totalMinutes > dailyTargetMinutes ? ' is-over-target' : ''}`}
                              key={day.dateKey}
                            >
                              <header>
                                <strong>{`${day.dayLabel} · ${shortDate(day.dateKey)}`}</strong>
                                <span>{`${day.totalMinutes} 分钟 · ${day.lessons.length} 节`}</span>
                              </header>
                              <ul>
                                {day.lessons.map((lesson) => (
                                  <li key={lesson.lessonId}>
                                    <span className="pf-preview-lesson-name">
                                      <span className="pf-preview-course-title">
                                        {lesson.courseTitle}
                                      </span>
                                      <span aria-hidden="true"> · </span>
                                      <span>{lesson.lessonTitle}</span>
                                    </span>
                                    <span className="pf-preview-lesson-duration">
                                      {`${lesson.durationMinutes} min`}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                              {day.totalMinutes > dailyTargetMinutes ? (
                                <span className="pf-day-warning">超过每日目标</span>
                              ) : null}
                            </article>
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                  <div
                    className="pf-note"
                    role={preview.conflicts.length === 0 ? undefined : 'alert'}
                  >
                    预览不会修改正式排期。
                    {preview.conflicts.length === 0
                      ? '未发现排期冲突。'
                      : `冲突：${preview.conflicts.join('、')}`}
                  </div>
                  {previewIsStale ? (
                    <div className="pf-note" role="status">
                      排期条件已改变，当前内容是上一次预览。请重新生成后再确认。
                    </div>
                  ) : null}
                </>
              )}
              {error === undefined ? null : (
                <div className="pf-note" role="alert">
                  {error}
                </div>
              )}
              <div className="pf-preview-action">
                {preview === undefined ? (
                  <button
                    className="pf-btn primary"
                    disabled={busy}
                    type="button"
                    onClick={() => void generatePreview()}
                  >
                    生成计划预览
                  </button>
                ) : preview.state === 'confirmed' ? (
                  <div className="pf-actions">
                    <button
                      className="pf-btn"
                      disabled={busy || preview.undoAvailable !== true}
                      type="button"
                      onClick={() => void manage('undo')}
                    >
                      撤回排期
                    </button>
                  </div>
                ) : previewIsStale ? (
                  <button
                    className="pf-btn primary"
                    disabled={busy}
                    type="button"
                    onClick={() => void generatePreview()}
                  >
                    {busy ? '正在重新排期…' : '重新生成排期'}
                  </button>
                ) : (
                  <button
                    className="pf-btn primary"
                    disabled={busy}
                    type="button"
                    onClick={() => void confirm()}
                  >
                    确认计划流
                  </button>
                )}
              </div>
            </section>
          ) : null}
        </main>

        <footer className="pf-footer">
          <button
            className="pf-btn"
            disabled={step === 0}
            type="button"
            onClick={() => setStep((current) => Math.max(0, current - 1))}
          >
            上一步
          </button>
          <span className="pf-footer-note">第 {step + 1} 步，共 4 步</span>
          <div className="pf-actions">
            <button className="pf-btn" type="button" onClick={props.onClose}>
              取消
            </button>
            {step === 3 ? null : (
              <button
                className="pf-btn primary"
                type="button"
                onClick={() => {
                  if (validateStep()) setStep((current) => Math.min(3, current + 1));
                }}
              >
                下一步
              </button>
            )}
          </div>
        </footer>
      </section>
    </div>
  );

  if (props.fullFrame !== true) return <div className="pf-modal-frame">{wizard}</div>;

  return (
    <div className="pf-stack">
      <section className="pf-frame" aria-label="计划流四步向导">
        <div className="pf-top">
          <div className="pf-brand">
            <strong>Learning MORE</strong>
            <span>学习即生活｜让计划真正落地</span>
          </div>
          <div className="pf-runtime">
            <span>● 课程规划</span>
            <span>● 排期服务准备就绪</span>
          </div>
        </div>
        {wizard}
      </section>
    </div>
  );
}
