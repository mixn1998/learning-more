import { useMemo, useState } from 'react';

import type { HomeDashboardView } from '@learning-more/contracts';

import type { PlanFlowAction, PlanFlowPreviewView } from '../../client/planning-client.js';

import './planning-workspace.css';

const steps = ['学习节奏', '选择课程', '排期策略', '预览确认'] as const;
const weekdays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const;

type HomeCourse = HomeDashboardView['courses'][number];
type HomeLesson = HomeDashboardView['lessons'][number];

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
  if (errorCode === 'generation_task_not_dispatchable') {
    return '后台生成队列暂时不可用，请重试。';
  }
  if (errorCode === 'generation_timeout' || errorCode === 'provider_timeout') {
    return '计划预览生成超时，请重试。';
  }
  if (errorCode === 'plan_preview_invalid') {
    return 'AI 返回的排期结构未通过校验，请重试。';
  }
  return '预览生成失败，输入约束已保留。';
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
    setBusy(true);
    setError(undefined);
    try {
      const result = await props.onPreview({
        courseIds: selectedCourseIds,
        lessonIds: selectedLessonIds,
        startDate,
        dailyTargetMinutes,
        learningDays,
        preserveExistingDates,
        rescheduleOverdue,
        strategy,
      });
      if (result.state === 'failed') {
        setPreview(undefined);
        setError(previewFailureMessage(result.errorCode));
      } else {
        setPreview(result);
      }
    } catch {
      setError('预览生成失败，输入约束已保留。');
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (preview === undefined) return;
    setBusy(true);
    setError(undefined);
    try {
      setPreview(await props.onConfirm(preview));
    } catch {
      setError('排期版本已变化，请重新预览。');
    } finally {
      setBusy(false);
    }
  }

  async function manage(action: PlanFlowAction) {
    if (preview === undefined) return;
    setBusy(true);
    setError(undefined);
    try {
      setPreview(await props.onManage(preview, action));
    } catch {
      setError('计划流状态已变化，请刷新后重试。');
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
                  <span>每日目标</span>
                  <b>{dailyTargetMinutes} min</b>
                </div>
                <div className="pf-summary">
                  <span>待排课节</span>
                  <b>{selectedLessonIds.length} 节</b>
                </div>
                <div className="pf-summary">
                  <span>包含课程</span>
                  <b>{selectedCourseIds.length} 门</b>
                </div>
              </div>
              {preview === undefined ? (
                <div className="pf-note">生成预览不会修改正式排期；确认后才会写入版本化日程。</div>
              ) : (
                <>
                  <div className="pf-preview">
                    {preview.suggestions.map((suggestion) => (
                      <article
                        className="pf-day"
                        key={`${suggestion.lessonId}:${suggestion.startAt}`}
                      >
                        <header>
                          <strong>{new Date(suggestion.startAt).toLocaleDateString()}</strong>
                          <span>
                            {Math.round(
                              (Date.parse(suggestion.endAt) - Date.parse(suggestion.startAt)) /
                                60_000,
                            )}{' '}
                            分钟
                          </span>
                        </header>
                        <ul>
                          <li>
                            {lessons.find((lesson) => lesson.lessonId === suggestion.lessonId)
                              ?.title ?? suggestion.lessonId}
                          </li>
                        </ul>
                      </article>
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
                      className="pf-btn soft"
                      disabled={busy}
                      type="button"
                      onClick={() =>
                        void manage(preview.lifecycleState === 'paused' ? 'resume' : 'pause')
                      }
                    >
                      {preview.lifecycleState === 'paused' ? '恢复计划流' : '暂停计划流'}
                    </button>
                    <button
                      className="pf-btn"
                      disabled={busy}
                      type="button"
                      onClick={() => void manage('reflow')}
                    >
                      重新排剩余
                    </button>
                    <button
                      className="pf-btn danger"
                      disabled={busy}
                      type="button"
                      onClick={() => void manage('end')}
                    >
                      删除计划
                    </button>
                  </div>
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
            <span>学习即生活｜用 AI 重塑学习方式</span>
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
