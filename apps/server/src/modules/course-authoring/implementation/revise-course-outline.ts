import { createHash } from 'node:crypto';

import type { CompiledCandidate } from '../ports/candidate-version-repository.js';
import type { CourseCreationRepositories } from '../ports/course-repositories.js';
import type { LessonDefinition } from '../model/lesson-definition.js';
import type { UnitOfWork } from '../../../persistence/unit-of-work.js';

class CourseRevisionError extends Error {
  constructor(readonly code: 'course_closed' | 'lesson_semantic_rebind') {
    super(code);
    this.name = 'CourseRevisionError';
  }
}

function lessonId(outlineVersionId: string, semanticKey: string): string {
  return `lesson_${createHash('sha256')
    .update(`${outlineVersionId}\u0000${semanticKey}`)
    .digest('hex')
    .slice(0, 32)}`;
}

function sameSemanticMeaning(
  existing: LessonDefinition,
  candidate: CompiledCandidate['lessons'][number],
): boolean {
  return (
    existing.title === candidate.title &&
    existing.objective === candidate.objective &&
    JSON.stringify(existing.coreKnowledgePoints) === JSON.stringify(candidate.coreKnowledgePoints)
  );
}

export async function reviseCourseOutline(
  command: {
    readonly adjustmentSessionId: string;
    readonly courseId: string;
    readonly sourceCandidateVersionId: string;
    readonly newOutlineVersionId: string;
    readonly expectedCourseVersion: number;
    readonly candidate: CompiledCandidate;
  },
  dependencies: {
    readonly repositories: CourseCreationRepositories;
    readonly unitOfWork: UnitOfWork;
    readonly hasLearningEvidence: (lessonId: string) => Promise<boolean>;
    readonly now: () => Date;
  },
): Promise<{ outlineVersionId: string }> {
  const course = await dependencies.repositories.courses.get(command.courseId);
  if (course === undefined) throw new Error('COURSE_NOT_FOUND');
  if (course.status === 'closed') throw new CourseRevisionError('course_closed');
  const existingLessons: LessonDefinition[] = [];
  for await (const lesson of dependencies.repositories.lessons.listByCourse(command.courseId)) {
    existingLessons.push(lesson);
  }
  const existingBySemanticKey = new Map(
    existingLessons.map((lesson) => [lesson.semanticKey, lesson]),
  );
  const chosenIds = new Map<string, string>();
  for (const candidate of command.candidate.lessons) {
    const existing = existingBySemanticKey.get(candidate.id);
    if (existing !== undefined && (await dependencies.hasLearningEvidence(existing.id))) {
      if (!sameSemanticMeaning(existing, candidate)) {
        throw new CourseRevisionError('lesson_semantic_rebind');
      }
      chosenIds.set(candidate.id, existing.id);
    } else {
      chosenIds.set(candidate.id, lessonId(command.newOutlineVersionId, candidate.id));
    }
  }
  const createdAt = dependencies.now().toISOString();
  const lessonIds = command.candidate.lessons.map((lesson) => chosenIds.get(lesson.id)!);
  await dependencies.unitOfWork.execute(
    { transactionId: `tx_outline_revision_${command.adjustmentSessionId}` },
    async (tx) => {
      await dependencies.repositories.outlineVersions.save(
        tx,
        {
          id: command.newOutlineVersionId,
          courseId: command.courseId,
          sourceCandidateVersionId: command.sourceCandidateVersionId,
          outlineMarkdown: command.candidate.outlineMarkdown,
          disciplineTag: command.candidate.disciplineTag,
          topicTags: command.candidate.topicTags,
          createdAt,
          resourceVersion: 0,
        },
        0,
      );
      for (const candidate of command.candidate.lessons) {
        const id = chosenIds.get(candidate.id)!;
        if (existingLessons.some((lesson) => lesson.id === id)) continue;
        await dependencies.repositories.lessons.save(
          tx,
          {
            id,
            courseId: command.courseId,
            outlineVersionId: command.newOutlineVersionId,
            semanticKey: candidate.id,
            title: candidate.title,
            objective: candidate.objective,
            coreKnowledgePoints: candidate.coreKnowledgePoints,
            prerequisiteLessonIds: candidate.prerequisiteLessonIds.map((key) =>
              chosenIds.get(key)!,
            ),
            estimatedMinutes: candidate.estimatedMinutes,
            sourceRefs: candidate.sourceRefs,
            resourceVersion: 0,
          },
          0,
        );
      }
      await dependencies.repositories.courses.save(
        tx,
        {
          ...course,
          outlineVersionId: command.newOutlineVersionId,
          lessonIds,
          recommendedLessonId: lessonIds[0]!,
        },
        command.expectedCourseVersion,
      );
    },
  );
  return { outlineVersionId: command.newOutlineVersionId };
}
