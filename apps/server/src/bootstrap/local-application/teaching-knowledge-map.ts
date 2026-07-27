import type { TeachingKnowledgeMapPosition } from '../../modules/interactive-teaching/ports/teaching-context-sources.js';

type CourseLessonOrder = Readonly<{
  lessonIds: readonly string[];
}>;

type LessonIdentity = Readonly<{
  id: string;
  semanticKey: string;
  title: string;
  objective: string;
}>;

type OutlineIdentity = Readonly<{
  disciplineTag: string;
}>;

type CandidateIdentity = Readonly<{
  candidate: Readonly<{
    courseGoals: readonly string[];
    modules: readonly Readonly<{
      id: string;
      title: string;
      lessonIds: readonly string[];
    }>[];
    lessons: readonly Readonly<{
      id: string;
      title: string;
      objective: string;
    }>[];
  }>;
}>;

type TeachingKnowledgeMapInput = Readonly<{
  course: CourseLessonOrder;
  currentLesson: LessonIdentity;
  activeLessons: readonly LessonIdentity[];
  outline: OutlineIdentity;
  candidate: CandidateIdentity;
}>;

function uniqueTitleMatch<T extends Readonly<{ title: string }>>(
  values: readonly T[],
  title: string,
): T | undefined {
  const matches = values.filter((value) => value.title.trim() === title.trim());
  return matches.length === 1 ? matches[0] : undefined;
}

export function projectTeachingKnowledgeMap(
  input: TeachingKnowledgeMapInput,
): TeachingKnowledgeMapPosition | undefined {
  const candidateLesson =
    input.candidate.candidate.lessons.find(
      (lesson) => lesson.id === input.currentLesson.semanticKey,
    ) ?? uniqueTitleMatch(input.candidate.candidate.lessons, input.currentLesson.title);
  if (candidateLesson === undefined) return undefined;

  const moduleIndex = input.candidate.candidate.modules.findIndex((module) =>
    module.lessonIds.includes(candidateLesson.id),
  );
  const module = input.candidate.candidate.modules[moduleIndex];
  if (module === undefined) return undefined;

  const actualBySemanticKey = new Map(
    input.activeLessons.map((lesson) => [lesson.semanticKey, lesson] as const),
  );
  const moduleLessons = module.lessonIds.flatMap((semanticKey) => {
    const candidateDefinition = input.candidate.candidate.lessons.find(
      (lesson) => lesson.id === semanticKey,
    );
    const actual =
      actualBySemanticKey.get(semanticKey) ??
      (candidateDefinition === undefined
        ? undefined
        : uniqueTitleMatch(input.activeLessons, candidateDefinition.title));
    return actual === undefined
      ? []
      : [
          {
            lessonId: actual.id,
            title: actual.title,
            objective: actual.objective,
          },
        ];
  });
  const courseLessonIndex = input.course.lessonIds.indexOf(input.currentLesson.id);
  const moduleLessonIndex = moduleLessons.findIndex(
    (lesson) => lesson.lessonId === input.currentLesson.id,
  );
  if (courseLessonIndex < 0 || moduleLessonIndex < 0) return undefined;
  const previousModule = input.candidate.candidate.modules[moduleIndex - 1];
  const nextModule = input.candidate.candidate.modules[moduleIndex + 1];

  return {
    discipline: input.outline.disciplineTag,
    courseLessonIndex: courseLessonIndex + 1,
    courseLessonCount: input.course.lessonIds.length,
    currentModule: {
      id: module.id,
      title: module.title,
      lessonIndex: moduleLessonIndex + 1,
      lessonCount: moduleLessons.length,
      lessons: moduleLessons,
      ...(previousModule === undefined ? {} : { previousModuleTitle: previousModule.title }),
      ...(nextModule === undefined ? {} : { nextModuleTitle: nextModule.title }),
    },
    isFirstLessonInModule: moduleLessonIndex === 0,
    isFirstLessonInCourse: courseLessonIndex === 0,
  };
}
