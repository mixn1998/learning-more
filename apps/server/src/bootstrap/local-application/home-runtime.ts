import type { HomeRouteOptions } from '../../http/routes/home.js';
import { latestLearningActivityAt } from '../home-dashboard.js';
import { mapConcurrentOrdered } from '../../persistence/concurrent-map.js';
import type { LocalCourseRuntime } from './course-runtime.js';
import type { LocalLearningRuntime } from './learning-runtime.js';
import type { LocalPlanningRuntime } from './planning-runtime.js';

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of source) values.push(value);
  return values;
}

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
      const [draftRecords, courseRecords, scheduleRecords] = await Promise.all([
        collect(input.course.access.listDraftSessions()),
        collect(input.course.access.listCourses()),
        input.planning.access.listSchedule(),
      ]);
      const draftSessions = draftRecords.flatMap((record) =>
        record.session.state === 'confirmed' || record.session.savedAsDraft !== true
          ? []
          : [
              {
                outlineSessionId: record.session.outlineSessionId,
                topic: record.session.topic,
                courseMode: record.session.courseMode,
                state: record.session.state,
                resourceVersion: record.resourceVersion,
              },
            ],
      );
      const courseBundles = await mapConcurrentOrdered(
        courseRecords,
        async (course) => {
          const [confirmedOutline, lessonRows] = await Promise.all([
            input.course.access.getOutlineVersion(course.outlineVersionId),
            mapConcurrentOrdered(course.lessonIds, async (lessonId) => {
              const [lesson, learning] = await Promise.all([
                input.course.access.getLesson(lessonId),
                input.learning.access.getRecord(lessonId),
              ]);
              if (lesson === undefined) return undefined;
              const lastActivityAt = latestLearningActivityAt(learning?.intervals ?? []);
              const recommendation = course.nextLessonRecommendation;
              const recommendationRank =
                recommendation === undefined
                  ? -1
                  : recommendation.rankedLessonIds.indexOf(lessonId);
              return {
                courseId: course.id,
                lessonId,
                title: lesson.title,
                objective: lesson.objective,
                coreKnowledgePoints: [...lesson.coreKnowledgePoints],
                estimatedMinutes: lesson.estimatedMinutes,
                progress: learning?.learning.progress ?? ('not_started' as const),
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
              };
            }),
          ]);
          return {
            course: {
              courseId: course.id,
              title: course.title,
              status: course.status,
              courseMode: course.courseMode,
              outlineVersionId: course.outlineVersionId,
              disciplineTag: confirmedOutline?.disciplineTag,
              topicTags: [...(confirmedOutline?.topicTags ?? [])],
              resourceVersion: course.resourceVersion,
            },
            lessons: lessonRows.filter((lesson) => lesson !== undefined),
          };
        },
        8,
      );
      const courses = courseBundles.map((bundle) => bundle.course);
      const lessons = courseBundles.flatMap((bundle) => bundle.lessons);
      const schedule = scheduleRecords
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
