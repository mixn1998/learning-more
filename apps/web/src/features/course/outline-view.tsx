import type { CourseArchiveView } from '@learning-more/contracts';

export type CourseLessonProgress = 'not_started' | 'in_progress' | 'abandoned' | 'completed';

export type CourseLessonRuntimeState = Readonly<{
  progress: CourseLessonProgress;
  sessionId?: string | undefined;
}>;

export type CourseOutlineModule = Readonly<{
  title: string;
  lessonIds: readonly string[];
}>;

type CourseLesson = NonNullable<CourseArchiveView['lessons']>[number];

function defaultModules(lessons: readonly CourseLesson[]): readonly CourseOutlineModule[] {
  const modules: CourseOutlineModule[] = [];
  for (let offset = 0; offset < lessons.length; offset += 2) {
    const group = lessons.slice(offset, offset + 2);
    const first = group[0];
    if (first === undefined) continue;
    modules.push({
      title: first.objective,
      lessonIds: group.map((lesson) => lesson.lessonId),
    });
  }
  return modules;
}

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
  readonly modules?: readonly CourseOutlineModule[] | undefined;
  readonly lessonDescriptions?: Readonly<Record<string, string | undefined>> | undefined;
  readonly onOpenLesson: (lessonId: string, destination: 'lesson' | 'record') => void;
}) {
  const lessons = props.course.lessons ?? [];
  const lessonById = new Map(lessons.map((lesson) => [lesson.lessonId, lesson]));
  const modules = props.modules ?? defaultModules(lessons);
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
        const moduleLessons = module.lessonIds
          .map((lessonId) => lessonById.get(lessonId))
          .filter((lesson): lesson is CourseLesson => lesson !== undefined);
        if (moduleLessons.length === 0) return null;
        return (
          <section key={`${moduleIndex}-${module.title}`} className="course-module">
            <div className="course-module__title">
              <span>{String(moduleIndex + 1).padStart(2, '0')}</span>
              <b>{module.title}</b>
            </div>
            <div className="course-lessons">
              {moduleLessons.map((lesson) => {
                const state = props.lessonStates[lesson.lessonId];
                const progress = closed ? 'completed' : (state?.progress ?? 'not_started');
                const recommended = !closed && lesson.lessonId === props.course.recommendedLessonId;
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
                      <p>
                        {props.lessonDescriptions?.[lesson.lessonId] ??
                          (lesson.coreKnowledgePoints.length === 0
                            ? lesson.objective
                            : `${lesson.coreKnowledgePoints.join('、')}。`)}
                      </p>
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
