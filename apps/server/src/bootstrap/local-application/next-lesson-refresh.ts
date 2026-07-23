import type { LessonDefinition } from '../../modules/course-authoring/model/lesson-definition.js';
import { resolveNextLessonRecommendation } from '../../modules/next-lesson/implementation/recommendation-policy.js';
import type { LearningSessionRecord } from '../../persistence/learning-session-repositories.js';
import { createMarkdownArtifactStore } from '../../persistence/markdown-artifact-store.js';
import type { UnitOfWork } from '../../persistence/unit-of-work.js';
import type { LocalCourseRuntime } from './course-runtime.js';
import type { LocalGenerationRuntime } from './generation-runtime.js';
import type { LocalLearningRuntime } from './learning-runtime.js';
import type { LocalPlanningRuntime } from './planning-runtime.js';

export type NextLessonRefresh = (
  courseId: string,
  trigger?: 'lesson-completed' | 'schedule-changed',
  currentLessonId?: string,
) => Promise<void>;

export function createNextLessonRefresh(
  input: Readonly<{
    unitOfWork: UnitOfWork;
    artifactStore: ReturnType<typeof createMarkdownArtifactStore>;
    now: () => Date;
    course: LocalCourseRuntime;
    learning: LocalLearningRuntime;
    planning: LocalPlanningRuntime;
    generation: LocalGenerationRuntime;
  }>,
): NextLessonRefresh {
  return async function refreshNextLessonRecommendation(
    courseId,
    trigger = 'lesson-completed',
    currentLessonId?,
  ): Promise<void> {
    const course = await input.course.access.getCourse(courseId);
    if (course === undefined || course.status !== 'active') return;
    const lessons: LessonDefinition[] = [];
    for (const lessonId of course.lessonIds) {
      const lesson = await input.course.access.getLesson(lessonId);
      if (lesson !== undefined) lessons.push(lesson);
    }
    const semanticKeyById = new Map(lessons.map((lesson) => [lesson.id, lesson.semanticKey]));
    const completedSemanticKeys = [];
    const learningByLessonId = new Map<string, LearningSessionRecord | undefined>();
    for (const lesson of lessons) {
      const learning = await input.learning.access.getRecord(lesson.id);
      learningByLessonId.set(lesson.id, learning);
      if (learning?.learning.progress === 'completed') {
        completedSemanticKeys.push(lesson.semanticKey);
      }
    }
    const scheduled = (await input.planning.access.listSchedule()).filter(
      (item) => item.courseId === courseId && item.status === 'scheduled',
    );
    const currentLearning =
      currentLessonId === undefined ? undefined : learningByLessonId.get(currentLessonId);
    const currentFinalReviewMarkdown =
      currentLearning?.finalReview?.artifactRef === undefined
        ? undefined
        : (await input.artifactStore.read(currentLearning.finalReview.artifactRef))?.content;
    const previous = course.nextLessonRecommendation;
    const previousSemanticKey =
      previous === undefined ? undefined : semanticKeyById.get(previous.recommendedLessonId);
    const recommendation = await resolveNextLessonRecommendation({
      recommender: input.generation.nextLessonRecommender,
      now: input.now,
      input: {
        courseId,
        trigger,
        candidates: lessons.map((lesson) => {
          const learning = learningByLessonId.get(lesson.id);
          const scheduledStartAt = scheduled.find((item) => item.lessonId === lesson.id)?.startAt;
          return {
            semanticKey: lesson.semanticKey,
            title: lesson.title,
            objective: lesson.objective,
            prerequisiteSemanticKeys: lesson.prerequisiteLessonIds
              .map((id) => semanticKeyById.get(id))
              .filter((value): value is string => value !== undefined),
            estimatedMinutes: lesson.estimatedMinutes,
            progress: learning?.learning.progress ?? 'not_started',
            courseStatus: course.status,
            available: course.lessonIds.includes(lesson.id),
            activeSession: learning?.learning.progress === 'in_progress',
            ...(scheduledStartAt === undefined ? {} : { scheduledStartAt }),
            evidenceRefs: [
              ...lesson.sourceRefs,
              ...(learning?.finalReview?.artifactRef === undefined
                ? []
                : [learning.finalReview.artifactRef]),
            ],
          };
        }),
        completedSemanticKeys,
        ...(currentFinalReviewMarkdown === undefined ? {} : { currentFinalReviewMarkdown }),
        ...(scheduled.length === 0
          ? {}
          : {
              planSummary: scheduled
                .map((item) => `${item.lessonId}: ${item.startAt} - ${item.endAt}`)
                .join('\n'),
            }),
        ...(previous === undefined || previousSemanticKey === undefined
          ? {}
          : {
              previousRecommendation: {
                versionId: previous.versionId,
                semanticKey: previousSemanticKey,
                rankedSemanticKeys: previous.rankedLessonIds
                  .map((id) => semanticKeyById.get(id))
                  .filter((key): key is string => key !== undefined),
                rationale: previous.rationale,
                evidenceRefs: previous.evidenceRefs,
                confidence: previous.confidence,
                expiresAt: previous.expiresAt,
                sourceSnapshotHash: previous.sourceSnapshotHash,
                status: previous.status,
                warnings: previous.warnings,
              },
            }),
      },
    });
    const selected =
      recommendation === undefined
        ? undefined
        : lessons.find((lesson) => lesson.semanticKey === recommendation.semanticKey);
    if (recommendation !== undefined && selected === undefined) {
      throw new Error('next_lesson_recommendation_invalid');
    }
    const {
      recommendedLessonId: _previousRecommendedLessonId,
      nextLessonRecommendation: _previousRecommendation,
      ...courseWithoutRecommendation
    } = course;
    void _previousRecommendedLessonId;
    void _previousRecommendation;
    await input.unitOfWork.execute(
      { transactionId: `tx_next_lesson_${courseId}_${course.resourceVersion}` },
      (tx) =>
        input.course.access.saveCourse(
          tx,
          {
            ...courseWithoutRecommendation,
            ...(selected === undefined ? {} : { recommendedLessonId: selected.id }),
            ...(recommendation === undefined || selected === undefined
              ? {}
              : {
                  nextLessonRecommendation: {
                    versionId: recommendation.versionId,
                    recommendedLessonId: selected.id,
                    rankedLessonIds: recommendation.rankedSemanticKeys
                      .map((key) => lessons.find((lesson) => lesson.semanticKey === key)?.id)
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
          course.resourceVersion,
        ),
    );
  };
}
