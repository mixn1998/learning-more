import { createHash } from 'node:crypto';

import { projectDisciplineLabel } from '@learning-more/contracts';

import type { CompiledCandidate } from '../ports/candidate-version-repository.js';
import type { CourseCreationRepositories } from '../ports/course-repositories.js';
import type { LessonDefinition } from '../model/lesson-definition.js';
import { resolveLessonKnowledgeStructure } from '../model/knowledge-structure.js';
import type { UnitOfWork } from '../../../persistence/unit-of-work.js';
import { RepositoryVersionConflictError } from '../../../persistence/repository-errors.js';
import {
  resolveNextLessonRecommendation,
  type NextLessonRecommender,
} from '../../next-lesson/interface.js';
import type { PlanningOutlineRevisionParticipant } from '../../planning/interface.js';

class CourseRevisionError extends Error {
  constructor(
    readonly code: 'course_closed' | 'lesson_semantic_rebind' | 'source_snapshot_changed',
  ) {
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
    JSON.stringify(existing.knowledgeStructure) ===
      JSON.stringify(resolveLessonKnowledgeStructure(candidate))
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
    readonly currentOutlineSemanticKeys?: readonly string[];
  },
  dependencies: {
    readonly repositories: CourseCreationRepositories;
    readonly unitOfWork: UnitOfWork;
    readonly getLessonProgress?: (
      lessonId: string,
    ) => Promise<'not_started' | 'in_progress' | 'abandoned' | 'completed'>;
    readonly isLessonCompleted?: (lessonId: string) => Promise<boolean>;
    readonly nextLessonRecommender?: NextLessonRecommender;
    readonly liveCleanup?: PlanningOutlineRevisionParticipant;
    readonly now: () => Date;
  },
): Promise<{ outlineVersionId: string }> {
  const course = await dependencies.repositories.courses.get(command.courseId);
  if (course === undefined) throw new Error('COURSE_NOT_FOUND');
  if (course.status === 'closed') throw new CourseRevisionError('course_closed');
  const getLessonProgress = async (
    lessonId: string,
  ): Promise<'not_started' | 'in_progress' | 'abandoned' | 'completed'> =>
    dependencies.getLessonProgress !== undefined
      ? dependencies.getLessonProgress(lessonId)
      : (await dependencies.isLessonCompleted?.(lessonId)) === true
        ? 'completed'
        : 'not_started';
  const historicalLessons: LessonDefinition[] = [];
  for await (const lesson of dependencies.repositories.lessons.listByCourse(command.courseId)) {
    historicalLessons.push(lesson);
  }
  const historicalById = new Map(historicalLessons.map((lesson) => [lesson.id, lesson]));
  const currentOutlineSemanticKeys =
    command.currentOutlineSemanticKeys === undefined
      ? undefined
      : new Set(command.currentOutlineSemanticKeys);
  const existingLessons = course.lessonIds
    .map((id) => historicalById.get(id))
    .filter(
      (lesson): lesson is LessonDefinition =>
        lesson !== undefined &&
        (currentOutlineSemanticKeys === undefined ||
          currentOutlineSemanticKeys.has(lesson.semanticKey)),
    );
  const existingById = new Map(existingLessons.map((lesson) => [lesson.id, lesson]));
  const progressByLessonId = new Map(
    await Promise.all(
      existingLessons.map(
        async (lesson) => [lesson.id, await getLessonProgress(lesson.id)] as const,
      ),
    ),
  );
  const frozenLessons = existingLessons.filter(
    (lesson) => progressByLessonId.get(lesson.id) !== 'not_started',
  );
  const completedLessons = frozenLessons.filter(
    (lesson) => progressByLessonId.get(lesson.id) === 'completed',
  );
  const activeOrder = new Map(course.lessonIds.map((id, index) => [id, index]));
  frozenLessons.sort(
    (left, right) =>
      (activeOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
        (activeOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER) || left.id.localeCompare(right.id),
  );
  const frozenBySemanticKey = new Map(frozenLessons.map((lesson) => [lesson.semanticKey, lesson]));
  const frozenCandidate = (lesson: LessonDefinition): CompiledCandidate['lessons'][number] => ({
    id: lesson.semanticKey,
    title: lesson.title,
    objective: lesson.objective,
    coreKnowledgePoints: lesson.coreKnowledgePoints,
    knowledgeStructure: lesson.knowledgeStructure,
    prerequisiteLessonIds: lesson.prerequisiteLessonIds
      .map((id) => existingById.get(id)?.semanticKey)
      .filter((key): key is string => key !== undefined),
    estimatedMinutes: lesson.estimatedMinutes,
    sourceRefs: lesson.sourceRefs,
  });
  const generatedLessons = command.candidate.lessons
    .filter(
      (candidate) =>
        !frozenLessons.some(
          (frozen) => frozen.semanticKey !== candidate.id && sameSemanticMeaning(frozen, candidate),
        ),
    )
    .map((candidate) => {
      const frozen = frozenBySemanticKey.get(candidate.id);
      return frozen === undefined ? candidate : frozenCandidate(frozen);
    });
  const generatedSemanticKeys = new Set(generatedLessons.map((lesson) => lesson.id));
  const effectiveLessons = [
    ...frozenLessons
      .filter((lesson) => !generatedSemanticKeys.has(lesson.semanticKey))
      .map(frozenCandidate),
    ...generatedLessons,
  ];
  const chosenIds = new Map<string, string>();
  const completedSemanticKeys = new Set(completedLessons.map((lesson) => lesson.semanticKey));
  for (const lesson of frozenLessons) {
    chosenIds.set(lesson.semanticKey, lesson.id);
  }
  for (const candidate of effectiveLessons) {
    if (chosenIds.has(candidate.id)) continue;
    chosenIds.set(candidate.id, lessonId(command.newOutlineVersionId, candidate.id));
  }
  const createdAt = dependencies.now().toISOString();
  const lessonIds = effectiveLessons.map((lesson) => chosenIds.get(lesson.id)!);
  const semanticKeyByExistingId = new Map(
    existingLessons.map((lesson) => [lesson.id, lesson.semanticKey]),
  );
  const previous = course.nextLessonRecommendation;
  const previousSemanticKey =
    previous === undefined ? undefined : semanticKeyByExistingId.get(previous.recommendedLessonId);
  const previousRecommendation =
    previous === undefined || previousSemanticKey === undefined
      ? undefined
      : {
          versionId: previous.versionId,
          semanticKey: previousSemanticKey,
          rankedSemanticKeys: previous.rankedLessonIds
            .map((id) => semanticKeyByExistingId.get(id))
            .filter((key): key is string => key !== undefined),
          rationale: previous.rationale,
          evidenceRefs: previous.evidenceRefs,
          confidence: previous.confidence,
          expiresAt: previous.expiresAt,
          sourceSnapshotHash: previous.sourceSnapshotHash,
          status: previous.status,
          warnings: previous.warnings,
        };
  const recommendation = await resolveNextLessonRecommendation({
    ...(dependencies.nextLessonRecommender === undefined
      ? {}
      : { recommender: dependencies.nextLessonRecommender }),
    now: dependencies.now,
    input: {
      courseId: command.courseId,
      trigger: 'outline-revised',
      candidates: effectiveLessons.map((lesson) => ({
        semanticKey: lesson.id,
        title: lesson.title,
        objective: lesson.objective,
        prerequisiteSemanticKeys: lesson.prerequisiteLessonIds,
        estimatedMinutes: lesson.estimatedMinutes,
        progress: completedSemanticKeys.has(lesson.id)
          ? ('completed' as const)
          : ('not_started' as const),
        courseStatus: 'active',
        available: true,
        activeSession: false,
        evidenceRefs: lesson.sourceRefs,
      })),
      completedSemanticKeys: [...completedSemanticKeys],
      ...(previousRecommendation === undefined ? {} : { previousRecommendation }),
    },
  });
  const recommendedLessonId =
    recommendation === undefined ? undefined : chosenIds.get(recommendation.semanticKey);
  if (recommendation !== undefined && recommendedLessonId === undefined) {
    throw new Error('next_lesson_recommendation_invalid');
  }
  const {
    recommendedLessonId: _previousRecommendedLessonId,
    nextLessonRecommendation: _previousRecommendation,
    ...courseWithoutRecommendation
  } = course;
  void _previousRecommendedLessonId;
  void _previousRecommendation;
  await dependencies.unitOfWork.execute(
    { transactionId: `tx_outline_revision_${command.adjustmentSessionId}` },
    async (tx) => {
      const currentCourse = await dependencies.repositories.courses.get(command.courseId);
      if (
        currentCourse === undefined ||
        currentCourse.resourceVersion !== command.expectedCourseVersion ||
        currentCourse.outlineVersionId !== course.outlineVersionId
      ) {
        throw new RepositoryVersionConflictError(currentCourse?.resourceVersion ?? 0);
      }
      for (const lesson of existingLessons) {
        if ((await getLessonProgress(lesson.id)) !== progressByLessonId.get(lesson.id)) {
          throw new CourseRevisionError('source_snapshot_changed');
        }
      }
      await dependencies.repositories.outlineVersions.save(
        tx,
        {
          id: command.newOutlineVersionId,
          courseId: command.courseId,
          sourceCandidateVersionId: command.sourceCandidateVersionId,
          outlineMarkdown: command.candidate.outlineMarkdown,
          disciplineTag:
            projectDisciplineLabel({
              disciplineTag: command.candidate.disciplineTag,
              topicTags: command.candidate.topicTags,
            }) ?? command.candidate.disciplineTag,
          topicTags: command.candidate.topicTags,
          createdAt,
          resourceVersion: 0,
        },
        0,
      );
      for (const candidate of effectiveLessons) {
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
            knowledgeStructure: resolveLessonKnowledgeStructure(candidate),
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
          ...courseWithoutRecommendation,
          outlineVersionId: command.newOutlineVersionId,
          lessonIds,
          ...(recommendedLessonId === undefined ? {} : { recommendedLessonId }),
          ...(recommendation === undefined
            ? {}
            : {
                nextLessonRecommendation: {
                  versionId: recommendation.versionId,
                  recommendedLessonId: recommendedLessonId!,
                  rankedLessonIds: recommendation.rankedSemanticKeys
                    .map((key) => chosenIds.get(key))
                    .filter((id): id is string => id !== undefined),
                  rationale: recommendation.rationale,
                  evidenceRefs: recommendation.evidenceRefs,
                  confidence: recommendation.confidence,
                  expiresAt: recommendation.expiresAt,
                  sourceSnapshotHash: recommendation.sourceSnapshotHash,
                  status: recommendation.status,
                  warnings: recommendation.warnings,
                },
              }),
        },
        command.expectedCourseVersion,
      );
      await dependencies.liveCleanup?.retireOutlineReferences(
        {
          courseId: command.courseId,
          retainedLessonIds: lessonIds,
          knownCourseLessonIds: course.lessonIds,
          commandId: `outline-revised:${command.adjustmentSessionId}`,
          occurredAt: createdAt,
        },
        tx,
      );
    },
  );
  return { outlineVersionId: command.newOutlineVersionId };
}
