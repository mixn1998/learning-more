import type { HomeRouteOptions } from '../../http/routes/home.js';
import { latestLearningActivityAt } from '../home-dashboard.js';
import { mapConcurrentOrdered } from '../../persistence/concurrent-map.js';
import type { LocalCourseRuntime } from './course-runtime.js';
import type { LocalLearningRuntime } from './learning-runtime.js';
import type { LocalPlanningRuntime } from './planning-runtime.js';
import type { DataRoot } from '../../persistence/data-root.js';
import type { ReadRevisionTracker } from '../../persistence/read-revision.js';
import { createSummarySnapshot } from '../../persistence/summary-snapshot.js';
import { HomeDashboardResponseSchema, projectDisciplineLabel } from '@learning-more/contracts';

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
    dataRoot: DataRoot;
    readRevision: ReadRevisionTracker;
  }>,
): HomeRouteOptions {
  const snapshot = createSummarySnapshot({
    dataRoot: input.dataRoot,
    name: 'home-dashboard-v2',
    schemaVersion: 2,
    sourceRevision: () => input.readRevision.current(['catalog', 'learning', 'schedule']),
    parse: (value) => HomeDashboardResponseSchema.parse(value),
    build: buildHome,
  });

  async function buildHome() {
    const [draftRecords, courseRecords, lessonRecords, learningRecords, scheduleRecords] =
      await Promise.all([
        collect(input.course.access.listDraftSessions()),
        collect(input.course.access.listCourses()),
        collect(input.course.access.listAllLessons()),
        collect(input.learning.access.listRecords()),
        input.planning.access.listSchedule(),
      ]);
    const lessonById = new Map(lessonRecords.map((lesson) => [lesson.id, lesson]));
    const learningByLessonId = new Map(learningRecords.map((record) => [record.lessonId, record]));
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
        const confirmedOutline = await input.course.access.getOutlineVersion(
          course.outlineVersionId,
        );
        const lessonRows = course.lessonIds.map((lessonId) => {
          const lesson = lessonById.get(lessonId);
          const learning = learningByLessonId.get(lessonId);
          if (lesson === undefined) return undefined;
          const lastActivityAt = latestLearningActivityAt(learning?.intervals ?? []);
          const recommendation = course.nextLessonRecommendation;
          const recommendationRank =
            recommendation === undefined ? -1 : recommendation.rankedLessonIds.indexOf(lessonId);
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
        });
        return {
          course: {
            courseId: course.id,
            title: course.title,
            status: course.status,
            courseMode: course.courseMode,
            outlineVersionId: course.outlineVersionId,
            ...(confirmedOutline?.disciplineTag === undefined
              ? {}
              : {
                  disciplineTag:
                    projectDisciplineLabel({
                      disciplineTag: confirmedOutline.disciplineTag,
                      title: course.title,
                      topicTags: confirmedOutline.topicTags,
                    }) ?? confirmedOutline.disciplineTag,
                }),
            topicTags: [...(confirmedOutline?.topicTags ?? [])],
            resourceVersion: course.resourceVersion,
          },
          lessons: lessonRows.filter((lesson) => lesson !== undefined),
        };
      },
      8,
    );
    return {
      generatedAt: input.now().toISOString(),
      draftSessions,
      courses: courseBundles.map((bundle) => bundle.course),
      lessons: courseBundles.flatMap((bundle) => bundle.lessons),
      schedule: scheduleRecords
        .filter((item) => item.status === 'scheduled')
        .map((item) => ({
          scheduleItemId: item.id,
          courseId: item.courseId,
          lessonId: item.lessonId,
          startAt: item.startAt,
          endAt: item.endAt,
          source: item.source,
          locked: item.locked ?? false,
        })),
    };
  }

  return {
    async getHome() {
      const current = await snapshot.current();
      return { etag: current.etag, value: current.value };
    },
  };
}
