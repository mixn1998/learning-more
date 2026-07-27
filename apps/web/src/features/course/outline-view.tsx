import type { CourseArchiveView } from '@learning-more/contracts';

import { projectOutlineMarkdown } from './outline-markdown-projection.js';

export type CourseLessonProgress = 'not_started' | 'in_progress' | 'abandoned' | 'completed';

export type CourseLessonRuntimeState = Readonly<{
  progress: CourseLessonProgress;
  sessionId?: string | undefined;
}>;

type CourseLesson = NonNullable<CourseArchiveView['lessons']>[number];

function lessonStateLabel(
  progress: CourseLessonProgress,
  closed: boolean,
  recommended: boolean,
): string {
  if (closed) return '查看课节记录';
  if (progress === 'completed') return '点击查看课节记录';
  if (progress === 'in_progress') return '学习中 · 继续学习';
  if (progress === 'abandoned') return '已放弃 · 恢复学习';
  return recommended ? '开始学习' : '开始学习';
}

export function OutlineView(props: {
  readonly course: CourseArchiveView;
  readonly lessonStates: Readonly<Record<string, CourseLessonRuntimeState | undefined>>;
  readonly outlineMarkdownByVersion?: Readonly<Record<string, string | undefined>> | undefined;
  readonly onOpenLesson: (lessonId: string, destination: 'lesson' | 'record') => void;
}) {
  const lessons = props.course.lessons ?? [];
  const lessonById = new Map(lessons.map((lesson) => [lesson.lessonId, lesson]));
  const lessonOrder = new Map(props.course.lessonIds.map((lessonId, index) => [lessonId, index]));
  const orderedLessons = [...lessons].sort(
    (left, right) =>
      (lessonOrder.get(left.lessonId) ?? Number.MAX_SAFE_INTEGER) -
        (lessonOrder.get(right.lessonId) ?? Number.MAX_SAFE_INTEGER) ||
      left.lessonId.localeCompare(right.lessonId),
  );
  const currentProjection = projectOutlineMarkdown(
    props.course.outlineMarkdown ?? '',
    orderedLessons.map((lesson) => ({ lessonId: lesson.lessonId, title: lesson.title })),
  );
  const currentMatchedLessonIds = new Set([
    ...currentProjection.modules.flatMap((module) =>
      module.lessons.flatMap((lesson) => (lesson.lessonId === undefined ? [] : [lesson.lessonId])),
    ),
    ...currentProjection.ungroupedLessons.flatMap((lesson) =>
      lesson.lessonId === undefined || lesson.markdown === '' ? [] : [lesson.lessonId],
    ),
  ]);
  const historicalFallbackLessons = orderedLessons.filter(
    (lesson) => !currentMatchedLessonIds.has(lesson.lessonId),
  );
  const historicalVersionIds = [
    ...new Set(historicalFallbackLessons.map((lesson) => lesson.outlineVersionId)),
  ];
  const historicalProjections = historicalVersionIds.map((outlineVersionId) => {
    const versionLessons = historicalFallbackLessons.filter(
      (lesson) => lesson.outlineVersionId === outlineVersionId,
    );
    return {
      outlineVersionId,
      projection: projectOutlineMarkdown(
        props.outlineMarkdownByVersion?.[outlineVersionId] ?? '',
        versionLessons.map((lesson) => ({ lessonId: lesson.lessonId, title: lesson.title })),
      ),
    };
  });
  const modules = [
    ...currentProjection.modules.map((module) => ({
      ...module,
      key: `${props.course.outlineVersionId}:${module.key}`,
    })),
    ...historicalProjections.flatMap(({ outlineVersionId, projection }) =>
      projection.modules.map((module) => ({
        ...module,
        key: `${outlineVersionId}:${module.key}`,
      })),
    ),
  ].sort((left, right) => {
    const firstLessonOrder = (module: (typeof modules)[number]) =>
      Math.min(
        ...module.lessons.map((lesson) =>
          lesson.lessonId === undefined
            ? Number.MAX_SAFE_INTEGER
            : (lessonOrder.get(lesson.lessonId) ?? Number.MAX_SAFE_INTEGER),
        ),
      );
    return firstLessonOrder(left) - firstLessonOrder(right);
  });
  const ungroupedLessons = [
    ...currentProjection.ungroupedLessons.filter((lesson) => lesson.markdown !== ''),
    ...historicalProjections.flatMap(({ projection }) => projection.ungroupedLessons),
  ];
  if (ungroupedLessons.length > 0) {
    modules.push({
      key: 'ungrouped-lessons',
      anchor: 'module:ungrouped-lessons',
      title: '未分组课程',
      markdown: '',
      lessons: ungroupedLessons,
    });
  }
  const closed = props.course.status === 'closed';
  const completed = closed
    ? lessons.length
    : lessons.filter((lesson) => props.lessonStates[lesson.lessonId]?.progress === 'completed')
        .length;
  const inProgress = closed
    ? 0
    : lessons.filter((lesson) => props.lessonStates[lesson.lessonId]?.progress === 'in_progress')
        .length;
  const abandoned = closed
    ? 0
    : lessons.filter((lesson) => props.lessonStates[lesson.lessonId]?.progress === 'abandoned')
        .length;

  return (
    <section aria-label="课程单元" className="lm-card course-outline">
      <div className="course-outline__header">
        <h2>课程单元</h2>
        <span className={`lm-pill${closed ? ' success' : ''}`}>
          {closed
            ? `已完成 ${completed} / ${lessons.length}`
            : `完成 ${completed} · 学习中 ${inProgress} · 放弃 ${abandoned}`}
        </span>
      </div>
      {modules.map((module, moduleIndex) => {
        const moduleLessons = module.lessons
          .map((lesson) =>
            lesson.lessonId === undefined ? undefined : lessonById.get(lesson.lessonId),
          )
          .filter((lesson): lesson is CourseLesson => lesson !== undefined);
        if (moduleLessons.length === 0) return null;
        return (
          <section key={module.key} className="course-module">
            <div className="course-module__title">
              <span>{String(moduleIndex + 1).padStart(2, '0')}</span>
              <b>{module.title}</b>
            </div>
            <div className="course-lessons">
              {moduleLessons.map((lesson) => {
                const state = props.lessonStates[lesson.lessonId];
                const progress = closed ? 'completed' : (state?.progress ?? 'not_started');
                const recommended =
                  !closed &&
                  progress !== 'completed' &&
                  lesson.lessonId === props.course.recommendedLessonId;
                const destination = progress === 'completed' ? 'record' : 'lesson';
                return (
                  <button
                    key={lesson.lessonId}
                    className={`course-lesson course-lesson--${progress}${recommended ? ' recommended' : ''}`}
                    type="button"
                    onClick={() => props.onOpenLesson(lesson.lessonId, destination)}
                  >
                    <span className="course-lesson__index">
                      {lessons.findIndex((item) => item.lessonId === lesson.lessonId) + 1}
                    </span>
                    <div className="course-lesson__copy">
                      <b>{lesson.title}</b>
                      <p>{lesson.objective}</p>
                    </div>
                    <span className="course-lesson__state">
                      {lessonStateLabel(progress, closed, recommended)}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </section>
  );
}
