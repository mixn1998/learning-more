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

const chinaOffsetMs = 8 * 60 * 60 * 1_000;
const dayMs = 24 * 60 * 60 * 1_000;

function chinaDayStart(value: Date): number {
  const shifted = new Date(value.getTime() + chinaOffsetMs);
  return (
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - chinaOffsetMs
  );
}

function chinaWeekWindow(value: Date): Readonly<{ from: number; to: number }> {
  const shifted = new Date(value.getTime() + chinaOffsetMs);
  const mondayOffset = (shifted.getUTCDay() + 6) % 7;
  const from = chinaDayStart(value) - mondayOffset * dayMs;
  return { from, to: from + 7 * dayMs };
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
    name: 'home-dashboard-v4',
    schemaVersion: 4,
    sourceRevision: () => input.readRevision.current(['catalog', 'learning', 'schedule']),
    parse: (value) => HomeDashboardResponseSchema.parse(value),
    build: buildHome,
  });

  async function buildHome() {
    const generatedAt = input.now();
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
    const lessons = courseBundles.flatMap((bundle) => bundle.lessons);
    const lessonProgress = new Map(lessons.map((lesson) => [lesson.lessonId, lesson.progress]));
    const scheduled = scheduleRecords.filter((item) => item.status === 'scheduled');
    const scheduledLessonIds = new Set(scheduled.map((item) => item.lessonId));
    const week = chinaWeekWindow(generatedAt);
    const todayStart = chinaDayStart(generatedAt);
    return {
      generatedAt: generatedAt.toISOString(),
      draftSessions,
      courses: courseBundles.map((bundle) => bundle.course),
      lessons,
      schedule: scheduled
        .filter((item) => Date.parse(item.startAt) < week.to && Date.parse(item.endAt) > week.from)
        .map((item) => ({
          scheduleItemId: item.id,
          courseId: item.courseId,
          lessonId: item.lessonId,
          startAt: item.startAt,
          endAt: item.endAt,
          source: item.source,
          locked: item.locked ?? false,
        })),
      pendingLessonCount: lessons.filter(
        (lesson) => lesson.progress === 'not_started' && !scheduledLessonIds.has(lesson.lessonId),
      ).length,
      overdueScheduleCount: scheduled.filter((item) => {
        const progress = lessonProgress.get(item.lessonId);
        return (
          progress !== 'completed' &&
          progress !== 'abandoned' &&
          Date.parse(item.startAt) < todayStart
        );
      }).length,
    };
  }

  return {
    async getHome() {
      const current = await snapshot.current();
      return { etag: current.etag, value: current.value };
    },
  };
}
