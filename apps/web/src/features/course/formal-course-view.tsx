import { useMemo, useState } from 'react';

import type {
  CourseArchiveView,
  CourseMode,
  CourseOutlineVersionView,
} from '@learning-more/contracts';
import { Button, Dialog } from '@learning-more/ui';

import { courseModeDefinition } from '../../course-mode-registry.js';
import { useCourseModeTheme } from '../../use-course-mode-theme.js';
import { CourseArchiveDangerZone } from '../review/course-archive-danger-zone.js';
import {
  OutlineView,
  type CourseLessonRuntimeState,
  type CourseOutlineModule,
} from './outline-view.js';
import { OutlineVersionHistory } from './outline-version-history.js';

import './formal-course-view.css';

export type CourseDirectoryItem = Readonly<{
  courseId: string;
  title: string;
  status: 'active' | 'closed';
  courseMode: CourseMode;
  progressLabel?: string | undefined;
}>;

export function FormalCourseView(props: {
  readonly course: CourseArchiveView;
  readonly currentOutline?: CourseOutlineVersionView | undefined;
  readonly lessonStates: Readonly<Record<string, CourseLessonRuntimeState | undefined>>;
  readonly lessonDescriptions?: Readonly<Record<string, string | undefined>> | undefined;
  readonly modules?: readonly CourseOutlineModule[] | undefined;
  readonly availableCourses?: readonly CourseDirectoryItem[] | undefined;
  readonly initiallyOpenDelete?: boolean | undefined;
  readonly onCloseCourse: () => void;
  readonly onDeleteCourse: () => Promise<void>;
  readonly onModifyOutline: () => void;
  readonly onNavigate: (path: string) => void;
  readonly onOpenReview: () => void;
  readonly onSelectVersion: (outlineVersionId: string) => Promise<CourseOutlineVersionView>;
}) {
  const { course } = props;
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [chooserOpen, setChooserOpen] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<CourseOutlineVersionView>();
  const [versionError, setVersionError] = useState<string>();
  const mode = courseModeDefinition(course.courseMode);
  useCourseModeTheme(course.courseMode);

  const lessons = course.lessons ?? [];
  const completed =
    course.status === 'closed'
      ? lessons.length
      : lessons.filter((lesson) => props.lessonStates[lesson.lessonId]?.progress === 'completed')
          .length;
  const allCompleted =
    lessons.length > 0
      ? completed === lessons.length
      : course.lessonIds.length > 0 && course.lessons === undefined;
  const recommended =
    lessons.find((lesson) => lesson.lessonId === course.recommendedLessonId) ??
    lessons.find((lesson) => props.lessonStates[lesson.lessonId]?.progress !== 'completed');
  const otherCourses = (props.availableCourses ?? []).filter(
    (item) => item.courseId !== course.courseId,
  );
  const versionNumber = Math.max(
    1,
    (course.outlineVersions ?? []).findIndex((version) => version.current) + 1,
  );
  const discipline = props.currentOutline?.disciplineTag ?? '课程主题';
  const tags = props.currentOutline?.topicTags ?? [];
  const meta = [discipline, tags.join('、'), `大纲 v${versionNumber}`]
    .filter((part) => part !== '')
    .join(' · ');
  const progressPercent = lessons.length === 0 ? 0 : Math.round((completed / lessons.length) * 100);
  const versionRows = useMemo(() => course.outlineVersions ?? [], [course.outlineVersions]);

  const openVersion = (outlineVersionId: string) => {
    setVersionError(undefined);
    void props.onSelectVersion(outlineVersionId).then(setSelectedVersion, () => {
      setVersionError('历史版本暂时不可用，请稍后重试。');
    });
  };

  return (
    <main
      className={`lm-page formal-course-page formal-course-page--${course.status}`}
      data-course-mode={course.courseMode}
    >
      <section className="lm-card course-hero">
        <div className="course-hero__copy">
          <div className="lm-kicker">
            {course.courseMode.toUpperCase()} ·{' '}
            {course.status === 'closed' ? '已关闭课程' : '正式课程'}
          </div>
          <h1>{course.title}</h1>
          <p>{meta}</p>
          <div className="lm-chips course-hero__chips">
            <span className="lm-mode-badge">● {mode.label}</span>
            <span className={`lm-pill${course.status === 'closed' ? ' success' : ''}`}>
              {course.status === 'closed'
                ? `${lessons.length} 个课节已完成`
                : `${lessons.length} 个课节`}
            </span>
          </div>
        </div>
        <div className="course-hero__actions">
          <div className="lm-actions">
            <Button type="button" onClick={() => props.onNavigate('/')}>
              返回主页
            </Button>
            {otherCourses.length === 0 ? null : (
              <Button type="button" onClick={() => setChooserOpen(true)}>
                切换课程
              </Button>
            )}
            {course.status === 'active' ? (
              <Button type="button" onClick={props.onModifyOutline}>
                修改大纲
              </Button>
            ) : null}
          </div>
          <CourseArchiveDangerZone
            courseTitle={course.title}
            initiallyOpen={props.initiallyOpenDelete}
            onDelete={props.onDeleteCourse}
          />
        </div>
      </section>

      <div className="course-layout">
        <OutlineView
          course={course}
          lessonDescriptions={props.lessonDescriptions}
          lessonStates={props.lessonStates}
          modules={props.modules}
          onOpenLesson={(lessonId, destination) =>
            props.onNavigate(
              destination === 'record'
                ? `/courses/${course.courseId}/lessons/${lessonId}/record`
                : `/courses/${course.courseId}/lessons/${lessonId}`,
            )
          }
        />
        <aside className="lm-card course-side">
          <section className="course-progress">
            <div className="course-progress__head">
              <h3>课程进度</h3>
              <strong>
                {completed} / {lessons.length}
              </strong>
            </div>
            <div
              aria-label={`课程进度 ${progressPercent}%`}
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={progressPercent}
              className="course-progress__track"
              role="progressbar"
            >
              <i style={{ width: `${progressPercent}%` }} />
            </div>
          </section>

          {course.status === 'closed' ? (
            <section className="course-closed-note">
              <div className="lm-kicker">COURSE REVIEW</div>
              <h3>课程已关闭</h3>
              <p>本课程的课节 Review 已汇总为主题总 Review。</p>
              <Button type="button" variant="primary" onClick={props.onOpenReview}>
                查看主题总结
              </Button>
            </section>
          ) : recommended === undefined ? null : (
            <section className="course-recommendation">
              <strong>{recommended.title}</strong>
              <p>{recommended.objective}</p>
              <Button
                type="button"
                variant="primary"
                onClick={() =>
                  props.onNavigate(`/courses/${course.courseId}/lessons/${recommended.lessonId}`)
                }
              >
                查看课节导航
              </Button>
            </section>
          )}

          {course.status === 'active' && allCompleted ? (
            <section className="course-close-action">
              <p>全部课节已完成，可以生成课程主题总结并关闭课程。</p>
              <Button type="button" variant="primary" onClick={props.onCloseCourse}>
                关闭课程并生成总结
              </Button>
            </section>
          ) : null}

          <nav aria-label="课程辅助入口" className="course-side-links">
            <button type="button" onClick={() => setVersionsOpen(true)}>
              {course.status === 'closed' ? '查看大纲版本记录' : '大纲版本记录'}
            </button>
            {course.status === 'active' ? <span className="disabled">主题总结</span> : null}
          </nav>
        </aside>
      </div>

      <Dialog
        className="course-version-dialog"
        footer={
          <Button type="button" onClick={() => setVersionsOpen(false)}>
            关闭
          </Button>
        }
        onClose={() => setVersionsOpen(false)}
        open={versionsOpen}
        title="大纲版本记录"
      >
        <OutlineVersionHistory versions={versionRows} onSelect={openVersion} />
        {selectedVersion === undefined ? null : (
          <section className="course-version-preview">
            <b>{selectedVersion.current ? '当前确认版' : '只读历史版'}</b>
            <p>{selectedVersion.outlineMarkdown}</p>
          </section>
        )}
        {versionError === undefined ? null : <p role="alert">{versionError}</p>}
      </Dialog>

      <Dialog
        className="course-chooser-dialog"
        footer={
          <Button type="button" onClick={() => setChooserOpen(false)}>
            关闭
          </Button>
        }
        onClose={() => setChooserOpen(false)}
        open={chooserOpen}
        title="切换课程"
      >
        <div className="course-choice-list">
          {otherCourses.map((item) => (
            <button
              key={item.courseId}
              className="course-choice"
              type="button"
              onClick={() => props.onNavigate(`/courses/${item.courseId}`)}
            >
              <span>
                <b>{item.title}</b>
                <small>
                  {item.progressLabel ??
                    `${courseModeDefinition(item.courseMode).label} · 正式课程`}
                </small>
              </span>
              <em>{item.status === 'closed' ? '已关闭' : '查看课程'}</em>
            </button>
          ))}
        </div>
      </Dialog>
    </main>
  );
}
