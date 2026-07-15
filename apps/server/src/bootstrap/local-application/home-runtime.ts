import type { HomeRouteOptions } from '../../http/routes/home.js';
import { latestLearningActivityAt } from '../home-dashboard.js';
import type { LocalCourseRuntime } from './course-runtime.js';
import type { LocalLearningRuntime } from './learning-runtime.js';
import type { LocalPlanningRuntime } from './planning-runtime.js';

export function createHomeRouteOptions(
  input: Readonly<{
    now: () => Date;
    course: LocalCourseRuntime;
    learning: LocalLearningRuntime;
    planning: LocalPlanningRuntime;
  }>,
): HomeRouteOptions {
  return {
    async getHome() {
      const draftSessions = [];
      for await (const record of input.course.access.listDraftSessions()) {
        if (record.session.state === 'confirmed' || record.session.savedAsDraft !== true) continue;
        draftSessions.push({
          outlineSessionId: record.session.outlineSessionId,
          topic: record.session.topic,
          courseMode: record.session.courseMode,
          state: record.session.state,
          resourceVersion: record.resourceVersion,
        });
      }
      const courses = [];
      const lessons = [];
      for await (const course of input.course.access.listCourses()) {
        const confirmedOutline = await input.course.access.getOutlineVersion(
          course.outlineVersionId,
        );
        courses.push({
          courseId: course.id,
          title: course.title,
          status: course.status,
          courseMode: course.courseMode,
          outlineVersionId: course.outlineVersionId,
          disciplineTag: confirmedOutline?.disciplineTag,
          topicTags: [...(confirmedOutline?.topicTags ?? [])],
          resourceVersion: course.resourceVersion,
        });
        for (const lessonId of course.lessonIds) {
          const [lesson, learning] = await Promise.all([
            input.course.access.getLesson(lessonId),
            input.learning.access.getRecord(lessonId),
          ]);
          if (lesson === undefined) continue;
          const lastActivityAt = latestLearningActivityAt(learning?.intervals ?? []);
          const recommendation = course.nextLessonRecommendation;
          const recommendationRank =
            recommendation === undefined ? -1 : recommendation.rankedLessonIds.indexOf(lessonId);
          lessons.push({
            courseId: course.id,
            lessonId,
            title: lesson.title,
            objective: lesson.objective,
            coreKnowledgePoints: [...lesson.coreKnowledgePoints],
            estimatedMinutes: lesson.estimatedMinutes,
            progress: learning?.learning.progress ?? 'not_started',
            ...(learning?.learning.session?.id === undefined
              ? {}
              : { sessionId: learning.learning.session.id }),
            recommended: lessonId === course.recommendedLessonId && recommendationRank <= 0,
            ...(recommendation === undefined || recommendationRank < 0
              ? {}
              : {
                  recommendation: {
                    versionId: recommendation.versionId,
                    rank: recommendationRank + 1,
                    rationale: recommendation.rationale,
                    evidenceRefs: [...recommendation.evidenceRefs],
                    confidence: recommendation.confidence,
                    expiresAt: recommendation.expiresAt,
                    status: recommendation.status,
                    warnings: [...recommendation.warnings],
                  },
                }),
            ...(lastActivityAt === undefined ? {} : { lastActivityAt }),
          });
        }
      }
      const schedule = (await input.planning.access.listSchedule())
        .filter((item) => item.status === 'scheduled')
        .map((item) => ({
          scheduleItemId: item.id,
          courseId: item.courseId,
          lessonId: item.lessonId,
          startAt: item.startAt,
          endAt: item.endAt,
          source: item.source,
          locked: item.locked ?? false,
        }));
      return {
        generatedAt: input.now().toISOString(),
        draftSessions,
        courses,
        lessons,
        schedule,
      };
    },
  };
}
