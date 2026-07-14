export type HomeLessonCandidate = Readonly<{
  courseId: string;
  lessonId: string;
  title?: string | undefined;
  progress: 'not_started' | 'in_progress' | 'abandoned' | 'completed';
  sessionId?: string | undefined;
  recommended?: boolean | undefined;
  lastActivityAt?: string | undefined;
  recommendation?:
    | Readonly<{
        versionId: string;
        rank: number;
        rationale: string;
        evidenceRefs: readonly string[];
        confidence: number;
        expiresAt: string;
        status: 'current' | 'stale' | 'fallback';
        warnings: readonly string[];
      }>
    | undefined;
}>;

export type CourseChoiceModel = Readonly<{
  lessonCount: number;
  completedLessonCount: number;
  progressPercent: number;
  lastActivityAt?: string | undefined;
  nextLesson?: HomeLessonCandidate | undefined;
}>;

export function buildCourseChoiceModel(
  courseId: string,
  lessons: readonly HomeLessonCandidate[],
): CourseChoiceModel {
  const courseLessons = lessons.filter((lesson) => lesson.courseId === courseId);
  const completedLessonCount = courseLessons.filter(
    (lesson) => lesson.progress === 'completed',
  ).length;
  const lastActivityAt = courseLessons
    .flatMap((lesson) => (lesson.lastActivityAt === undefined ? [] : [lesson.lastActivityAt]))
    .sort((left, right) => right.localeCompare(left))[0];
  const nextLesson =
    courseLessons.find(
      (lesson) => lesson.progress === 'in_progress' && lesson.sessionId !== undefined,
    ) ??
    courseLessons.find(
      (lesson) => lesson.progress === 'not_started' && lesson.recommended === true,
    );

  return {
    lessonCount: courseLessons.length,
    completedLessonCount,
    progressPercent:
      courseLessons.length === 0
        ? 0
        : Math.round((completedLessonCount / courseLessons.length) * 100),
    ...(lastActivityAt === undefined ? {} : { lastActivityAt }),
    ...(nextLesson === undefined ? {} : { nextLesson }),
  };
}
