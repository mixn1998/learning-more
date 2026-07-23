import { useMemo, useRef, useState, type RefObject } from 'react';

import type { CourseMode } from '@learning-more/contracts';
import { Button, ContentState, Dialog } from '@learning-more/ui';

import {
  courseAuthoringClient,
  type CourseAuthoringClient,
} from '../../client/course-authoring-client.js';
import type { CourseModeDefinition } from '../../course-mode-registry.js';
import type { AuthoringStartIntent } from '../../state/authoring-start-intent.js';
import { getPageInstanceId } from '../../state/page-instance.js';
import { useCourseModeTheme } from '../../use-course-mode-theme.js';
import { CourseModeSelector } from '../course-authoring/course-mode-selector.js';
import { CourseCatalogFilters, filterCourseCatalog } from '../course/course-catalog-filters.js';
import { DeleteDraftDialog } from '../course-authoring/delete-draft-dialog.js';
import { buildCourseChoiceModel, type HomeLessonCandidate } from './course-choice-model.js';

export type { HomeLessonCandidate } from './course-choice-model.js';

type HomeDraft = Readonly<{
  outlineSessionId: string;
  topic: string;
  resourceVersion?: number | undefined;
  courseMode?: CourseMode | undefined;
  state?: string | undefined;
}>;

type HomeCourse = Readonly<{
  courseId: string;
  title: string;
  status?: 'active' | 'closed' | undefined;
  courseMode?: CourseMode | undefined;
  disciplineTag?: string | undefined;
}>;

type HomeScheduleItem = Readonly<{
  scheduleItemId: string;
  courseId: string;
  lessonId: string;
  startAt: string;
  endAt: string;
  source: 'manual' | 'plan-flow';
  locked: boolean;
}>;

const dayNames = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function localDateKey(value: Date): string {
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

function monthDay(value: Date): string {
  return `${pad(value.getMonth() + 1)}/${pad(value.getDate())}`;
}

function addDays(value: Date, amount: number): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate() + amount);
}

function startOfWeek(value: Date): Date {
  const mondayOffset = (value.getDay() + 6) % 7;
  return addDays(value, -mondayOffset);
}

const recentLearningFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const draftStateLabels: Readonly<Record<string, string>> = {
  'collecting-input': '等待补充学习需求',
  assessing: '正在评估学习起点',
  'ready-for-candidates': '准备生成候选大纲',
  'generating-candidates': '正在生成候选大纲',
  'candidate-ready': '候选大纲已生成',
  confirming: '正在确认正式课程',
};

function draftStateLabel(state: string | undefined): string {
  return state === undefined ? '继续完成课程建档' : (draftStateLabels[state] ?? '继续完成课程建档');
}

export function selectContinueTarget(
  lessons: readonly HomeLessonCandidate[],
): HomeLessonCandidate | undefined {
  return (
    lessons.find((lesson) => lesson.progress === 'in_progress' && lesson.sessionId !== undefined) ??
    lessons.find((lesson) => lesson.progress === 'not_started' && lesson.recommended === true)
  );
}

function scheduleLesson(
  item: HomeScheduleItem,
  lessons: readonly HomeLessonCandidate[],
): HomeLessonCandidate | undefined {
  return lessons.find(
    (lesson) => lesson.courseId === item.courseId && lesson.lessonId === item.lessonId,
  );
}

function scheduleTitle(item: HomeScheduleItem, lessons: readonly HomeLessonCandidate[]): string {
  return scheduleLesson(item, lessons)?.title ?? item.lessonId;
}

function isPendingSchedule(
  item: HomeScheduleItem,
  lessons: readonly HomeLessonCandidate[],
): boolean {
  const progress = scheduleLesson(item, lessons)?.progress;
  return progress !== 'completed' && progress !== 'abandoned';
}

function Prompt(props: {
  readonly mode: CourseModeDefinition;
  readonly topic: string;
  readonly materialFile?: File | undefined;
  readonly materialInputRef: RefObject<HTMLInputElement | null>;
  readonly topicInputRef: RefObject<HTMLInputElement | null>;
  readonly onTopicChange: (value: string) => void;
  readonly onMaterialSelected: (file: File | undefined) => void;
  readonly onSubmit: () => void;
}) {
  return (
    <form
      className="home-prompt"
      onSubmit={(event) => {
        event.preventDefault();
        props.onSubmit();
      }}
    >
      <div className="prompt-head">
        <strong>
          {props.mode.label} · {props.mode.prompt}
        </strong>
        <span className="lm-mode-badge">
          {props.mode.icon} {props.mode.label}
        </span>
      </div>
      <div className="prompt-row">
        <label className="home-topic-label">
          <span className="sr-only">学习主题</span>
          <input
            ref={props.topicInputRef}
            aria-label="学习主题"
            placeholder={props.mode.placeholder}
            value={props.topic}
            onChange={(event) => props.onTopicChange(event.target.value)}
          />
        </label>
        <Button type="submit" variant="primary">
          {props.mode.cta} →
        </Button>
      </div>
      {props.mode.id === 'reading_seminar' ? (
        <div className="upload visible">
          <div>
            <b>{props.materialFile?.name ?? '上传阅读材料'}</b>
            <br />
            <small>支持 PDF、TXT、Markdown 等可解析文本</small>
          </div>
          <Button type="button" onClick={() => props.materialInputRef.current?.click()}>
            {props.materialFile === undefined ? '选择文件' : '更换文件'}
          </Button>
          <input
            ref={props.materialInputRef}
            hidden
            accept=".pdf,.txt,.md,.markdown,text/plain,application/pdf,text/markdown"
            type="file"
            onChange={(event) => props.onMaterialSelected(event.currentTarget.files?.[0])}
          />
        </div>
      ) : null}
    </form>
  );
}

export function HomePage(props: {
  readonly client?: CourseAuthoringClient;
  readonly onNavigate: (path: string) => void;
  readonly onStartAuthoring?: ((intent: AuthoringStartIntent) => void) | undefined;
  readonly lessons?: readonly HomeLessonCandidate[];
  readonly draftSessions?: readonly HomeDraft[];
  readonly courses?: readonly HomeCourse[];
  readonly schedule?: readonly HomeScheduleItem[];
  readonly loading?: boolean;
  readonly error?: boolean;
  readonly notice?: string;
  readonly now?: Date;
}) {
  const api = props.client ?? courseAuthoringClient;
  const pageInstanceId = useMemo(getPageInstanceId, []);
  const now = props.now ?? new Date();
  const todayKey = localDateKey(now);
  const [topic, setTopic] = useState('');
  const [mode, setMode] = useState<CourseMode>('standard');
  const [materialFile, setMaterialFile] = useState<File>();
  const [weekAnchor, setWeekAnchor] = useState(() => startOfWeek(now));
  const [selectedDate, setSelectedDate] = useState(todayKey);
  const [chooserOpen, setChooserOpen] = useState(false);
  const [chooserDiscipline, setChooserDiscipline] = useState('');
  const [chooserMode, setChooserMode] = useState<CourseMode | ''>('');
  const [draftsOpen, setDraftsOpen] = useState(false);
  const [draftToDelete, setDraftToDelete] = useState<HomeDraft>();
  const [deletedDraftIds, setDeletedDraftIds] = useState<ReadonlySet<string>>(() => new Set());
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string>();
  const materialInputRef = useRef<HTMLInputElement>(null);
  const topicInputRef = useRef<HTMLInputElement>(null);
  const lessons = props.lessons ?? [];
  const drafts = (props.draftSessions ?? []).filter(
    (draft) => !deletedDraftIds.has(draft.outlineSessionId),
  );
  const courses = props.courses ?? [];
  const visibleCourses = filterCourseCatalog(courses, {
    discipline: chooserDiscipline,
    courseMode: chooserMode,
  });
  const schedule = [...(props.schedule ?? [])].sort((left, right) =>
    left.startAt.localeCompare(right.startAt),
  );
  const selectedMode = useCourseModeTheme(mode);
  const week = Array.from({ length: 7 }, (_, index) => addDays(weekAnchor, index));
  const weekEnd = week.at(-1)!;
  const selectedItems = schedule.filter(
    (item) => localDateKey(new Date(item.startAt)) === selectedDate,
  );
  const todayCount = schedule.filter(
    (item) => localDateKey(new Date(item.startAt)) === todayKey && isPendingSchedule(item, lessons),
  ).length;
  const overdueCount = schedule.filter(
    (item) => localDateKey(new Date(item.startAt)) < todayKey && isPendingSchedule(item, lessons),
  ).length;
  const scheduledLessons = new Set(schedule.map((item) => item.lessonId));
  const pendingCount = lessons.filter(
    (lesson) => lesson.progress === 'not_started' && !scheduledLessons.has(lesson.lessonId),
  ).length;
  const canContinue = courses.length > 0;

  const create = () => {
    const normalizedTopic = topic.trim();
    if (normalizedTopic === '') return;
    if (mode === 'reading_seminar' && materialFile === undefined) {
      materialInputRef.current?.focus();
      return;
    }
    props.onStartAuthoring?.({
      topic: normalizedTopic,
      courseMode: mode,
      ...(materialFile === undefined ? {} : { materialFile }),
    });
  };

  const deleteDraft = async () => {
    if (draftToDelete === undefined || deleteBusy) return;
    if (draftToDelete.resourceVersion === undefined) {
      setDeleteError('无法读取草稿版本，请刷新主页后重试。');
      return;
    }
    setDeleteBusy(true);
    setDeleteError(undefined);
    try {
      await api.deleteOutlineSession({
        outlineSessionId: draftToDelete.outlineSessionId,
        resourceVersion: draftToDelete.resourceVersion,
        pageInstanceId,
      });
      setDeletedDraftIds((current) => new Set([...current, draftToDelete.outlineSessionId]));
      setDraftToDelete(undefined);
      setDraftsOpen(true);
    } catch {
      setDeleteError('删除失败，草稿仍然保留，请稍后重试。');
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <main className="lm-page home-page home-page--sample">
      {props.loading ? <ContentState title="正在汇总学习主页…" /> : null}
      {props.error ? (
        <ContentState
          description="课程创建仍可使用；请检查运行中心后刷新。"
          role="status"
          title="主页数据暂时不可用"
        />
      ) : null}
      <section aria-label="创建课程" className="lm-card home-hero">
        <div>
          <div className="lm-kicker">Personal learning workspace</div>
          <h1>开始定制你的私人学习计划</h1>
          <Prompt
            materialFile={materialFile}
            materialInputRef={materialInputRef}
            mode={selectedMode}
            topic={topic}
            topicInputRef={topicInputRef}
            onMaterialSelected={setMaterialFile}
            onSubmit={create}
            onTopicChange={setTopic}
          />
          {props.notice === undefined ? null : <p role="status">{props.notice}</p>}
        </div>
        <div className="lm-actions home-hero-actions">
          <Button type="button" onClick={() => props.onNavigate('/history')}>
            历史统计
          </Button>
          {drafts.length > 0 ? (
            <Button type="button" onClick={() => setDraftsOpen(true)}>
              查看草稿
            </Button>
          ) : null}
          {canContinue ? (
            <Button type="button" variant="primary" onClick={() => setChooserOpen(true)}>
              继续学习
            </Button>
          ) : null}
        </div>
      </section>

      <div className="home-layout">
        <CourseModeSelector
          value={mode}
          variant="rail"
          onChange={(nextMode) => {
            setMode(nextMode);
            topicInputRef.current?.focus();
          }}
        />
        <section aria-label="本周课程表" className="lm-card schedule">
          <div className="schedule-head">
            <div>
              <h2>本周课程表</h2>
              <p>
                今日待学 {todayCount} 节，逾期 {overdueCount} 节，待规划 {pendingCount} 节
              </p>
            </div>
            <div className="lm-actions week-tools">
              <Button
                type="button"
                onClick={() => {
                  setWeekAnchor(startOfWeek(now));
                  setSelectedDate(todayKey);
                }}
              >
                返回当周
              </Button>
              <Button
                aria-label="上一周"
                className="week-step"
                type="button"
                onClick={() => setWeekAnchor((current) => addDays(current, -7))}
              >
                ‹
              </Button>
              <b className="week-range">
                {monthDay(weekAnchor)} — {monthDay(weekEnd)}
              </b>
              <Button
                aria-label="下一周"
                className="week-step"
                type="button"
                onClick={() => setWeekAnchor((current) => addDays(current, 7))}
              >
                ›
              </Button>
              <Button type="button" onClick={() => props.onNavigate('/planning')}>
                进行课程规划
              </Button>
              <Button type="button" onClick={() => props.onNavigate('/history?tab=weekly')}>
                上周学习回顾
              </Button>
            </div>
          </div>

          <div className="week">
            {week.map((date, index) => {
              const dateKey = localDateKey(date);
              const items = schedule.filter(
                (item) => localDateKey(new Date(item.startAt)) === dateKey,
              );
              return (
                <button
                  key={dateKey}
                  aria-pressed={selectedDate === dateKey}
                  className={[
                    'day',
                    dateKey === todayKey ? 'today' : undefined,
                    selectedDate === dateKey ? 'selected' : undefined,
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  type="button"
                  onClick={() => setSelectedDate(dateKey)}
                >
                  <span className="day-meta">
                    <small>
                      {dateKey === todayKey ? `${dayNames[index]} · 今天` : dayNames[index]}
                    </small>
                    <strong>{monthDay(date)}</strong>
                  </span>
                  {items.length === 0 ? (
                    <span className="day-empty">暂无安排</span>
                  ) : (
                    items.map((item) => (
                      <span
                        key={item.scheduleItemId}
                        className={[
                          'mini',
                          scheduleLesson(item, lessons)?.progress === 'completed'
                            ? 'mini--completed'
                            : undefined,
                        ]
                          .filter(Boolean)
                          .join(' ')}
                      >
                        {scheduleTitle(item, lessons)}
                      </span>
                    ))
                  )}
                </button>
              );
            })}
          </div>

          <section className="agenda">
            <h3>
              {selectedDate} · {selectedDate === todayKey ? '今日学习' : '学习安排'}
            </h3>
            <div className="agenda-list">
              {selectedItems.length === 0 ? (
                <p>当天暂无课程安排</p>
              ) : (
                selectedItems.map((item) => (
                  <button
                    key={item.scheduleItemId}
                    className="agenda-item"
                    type="button"
                    onClick={() =>
                      props.onNavigate(`/courses/${item.courseId}/lessons/${item.lessonId}`)
                    }
                  >
                    <b className="agenda-item__title">
                      {scheduleTitle(item, lessons)}
                      {selectedDate === todayKey ? (
                        <span
                          className={[
                            'agenda-item__status',
                            scheduleLesson(item, lessons)?.progress === 'completed'
                              ? 'agenda-item__status--completed'
                              : undefined,
                          ]
                            .filter(Boolean)
                            .join(' ')}
                        >
                          {scheduleLesson(item, lessons)?.progress === 'completed'
                            ? '已完成'
                            : '待学习'}
                        </span>
                      ) : null}
                    </b>
                    <span className="agenda-item__meta">
                      {courses.find((course) => course.courseId === item.courseId)?.title ??
                        item.courseId}{' '}
                      ·{' '}
                      {Math.max(
                        1,
                        Math.round(
                          (new Date(item.endAt).getTime() - new Date(item.startAt).getTime()) /
                            60_000,
                        ),
                      )}{' '}
                      分钟 →
                    </span>
                  </button>
                ))
              )}
            </div>
          </section>
        </section>
      </div>

      <Dialog
        className="course-chooser"
        footer={
          <Button type="button" onClick={() => setChooserOpen(false)}>
            返回主页
          </Button>
        }
        open={chooserOpen}
        title="选择课程"
        onClose={() => setChooserOpen(false)}
      >
        <section aria-label="课程列表">
          <CourseCatalogFilters
            courseMode={chooserMode}
            courses={courses}
            discipline={chooserDiscipline}
            onCourseModeChange={setChooserMode}
            onDisciplineChange={setChooserDiscipline}
          />
          {courses.length === 0 ? (
            <p>尚未创建课程</p>
          ) : visibleCourses.length === 0 ? (
            <p>没有符合当前筛选条件的课程。</p>
          ) : (
            visibleCourses.map((course) => {
              const model = buildCourseChoiceModel(course.courseId, lessons);
              const target = model.nextLesson;
              const alternatives = lessons
                .filter(
                  (lesson) =>
                    lesson.courseId === course.courseId &&
                    lesson.recommendation !== undefined &&
                    lesson.recommendation.rank > 1,
                )
                .sort((left, right) => left.recommendation!.rank - right.recommendation!.rank);
              const progressLabel =
                model.lastActivityAt === undefined
                  ? model.completedLessonCount === 0
                    ? `尚未开始 · 共 ${model.lessonCount} 节`
                    : `已完成 ${model.completedLessonCount}/${model.lessonCount} 节`
                  : `已完成 ${model.completedLessonCount}/${model.lessonCount} 节 · 最近学习 ${recentLearningFormatter.format(new Date(model.lastActivityAt))}`;
              const statusLabel =
                course.status === 'closed'
                  ? '已关闭'
                  : model.lessonCount > 0 && model.completedLessonCount === model.lessonCount
                    ? '已完成'
                    : target?.progress === 'in_progress'
                      ? '学习中'
                      : '未开始';
              return (
                <button
                  key={course.courseId}
                  className={[
                    'course-choice',
                    target?.progress === 'in_progress' ? 'in-progress' : undefined,
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  type="button"
                  onClick={() =>
                    props.onNavigate(
                      target === undefined
                        ? `/courses/${course.courseId}`
                        : `/courses/${target.courseId}/lessons/${target.lessonId}`,
                    )
                  }
                >
                  <span className="course-choice-content">
                    <b>{course.title}</b>
                    <span className="course-choice-meta">{progressLabel}</span>
                    <span
                      aria-label={`课程进度 ${model.progressPercent}%`}
                      aria-valuemax={100}
                      aria-valuemin={0}
                      aria-valuenow={model.progressPercent}
                      className="course-choice-progress"
                      role="progressbar"
                    >
                      <span style={{ width: `${model.progressPercent}%` }} />
                    </span>
                    {target?.progress === 'not_started' && target.recommendation !== undefined ? (
                      <span className="course-choice-recommendation">
                        <span>{target.recommendation.rationale}</span>
                        {alternatives.length === 0 ? null : (
                          <span>
                            备选：
                            {alternatives
                              .map((lesson) => lesson.title ?? lesson.lessonId)
                              .join('、')}
                          </span>
                        )}
                        {target.recommendation.status === 'fallback' ? (
                          <span>临时推荐 · AI 恢复后会重新评估</span>
                        ) : null}
                      </span>
                    ) : null}
                    <span className="course-choice-action">
                      {target === undefined
                        ? '查看课程大纲 →'
                        : `下一课：${target.title ?? target.lessonId} →`}
                    </span>
                  </span>
                  <em>{statusLabel}</em>
                </button>
              );
            })
          )}
        </section>
      </Dialog>

      <Dialog
        className="course-chooser"
        footer={
          <Button type="button" onClick={() => setDraftsOpen(false)}>
            返回主页
          </Button>
        }
        open={draftsOpen}
        title="查看草稿"
        onClose={() => setDraftsOpen(false)}
      >
        <section aria-label="已保存草稿">
          {drafts.map((draft) => (
            <div key={draft.outlineSessionId} className="course-choice course-choice--draft">
              <button
                className="course-choice-main"
                type="button"
                onClick={() =>
                  props.onNavigate(
                    `/courses/new?outlineSessionId=${encodeURIComponent(draft.outlineSessionId)}`,
                  )
                }
              >
                <span className="course-choice-content">
                  <b>{draft.topic}</b>
                  <span className="course-choice-meta">
                    大纲建档 · {draftStateLabel(draft.state)}
                  </span>
                  <span className="course-choice-action">继续完成大纲建档 →</span>
                </span>
              </button>
              <span className="course-choice-side">
                <em>草稿</em>
                <Button
                  className="course-choice-delete"
                  disabled={draft.resourceVersion === undefined}
                  type="button"
                  variant="danger"
                  onClick={() => {
                    setDraftsOpen(false);
                    setDeleteError(undefined);
                    setDraftToDelete(draft);
                  }}
                >
                  删除草稿
                </Button>
              </span>
            </div>
          ))}
        </section>
      </Dialog>

      <DeleteDraftDialog
        busy={deleteBusy}
        error={deleteError}
        open={draftToDelete !== undefined}
        onCancel={() => {
          setDeleteError(undefined);
          setDraftToDelete(undefined);
          setDraftsOpen(true);
        }}
        onConfirm={() => void deleteDraft()}
      />
    </main>
  );
}
