import { createHash } from 'node:crypto';

import { teachingPlayIntent } from '../../modules/interactive-teaching/implementation/teaching-play-intent.js';
import type { TeachingContextSources } from '../../modules/interactive-teaching/ports/teaching-context-sources.js';
import { createLocalFileMessageLog } from '../../modules/learning-session/implementation/message-log.js';
import { createLocalFileLearningSessionRepositories } from '../../persistence/learning-session-repositories.js';
import { createMarkdownArtifactStore } from '../../persistence/markdown-artifact-store.js';
import type { LocalCourseRuntime } from './course-runtime.js';

type LearningRepositories = ReturnType<typeof createLocalFileLearningSessionRepositories>;
type MessageLog = ReturnType<typeof createLocalFileMessageLog>;
type ArtifactStore = ReturnType<typeof createMarkdownArtifactStore>;

export function createLearningTeachingContext(input: {
  readonly course: LocalCourseRuntime['access'];
  readonly getLearningRecord: LearningRepositories['get'];
  readonly listMessages: MessageLog['list'];
  readonly artifactStore: Pick<ArtifactStore, 'read' | 'readDraft'>;
  readonly getPersonalizationView: TeachingContextSources['getPersonalizationView'];
}): TeachingContextSources {
  return {
    async getCourseAndLesson({ courseId, lessonId }) {
      const [course, lesson] = await Promise.all([
        input.course.getCourse(courseId),
        input.course.getLesson(lessonId),
      ]);
      if (course === undefined || lesson === undefined || lesson.courseId !== course.id) {
        throw Object.assign(new Error('resource_not_found'), { code: 'resource_not_found' });
      }
      const lessonMap = [];
      for await (const candidate of input.course.listLessons(courseId)) {
        lessonMap.push({
          lessonId: candidate.id,
          title: candidate.title,
          objective: candidate.objective,
          relation:
            candidate.id === lessonId
              ? ('current' as const)
              : lesson.prerequisiteLessonIds.includes(candidate.id)
                ? ('prerequisite' as const)
                : ('other' as const),
        });
      }
      const playIntent = teachingPlayIntent(course.courseMode);
      const teachingWeight = await input.course.getTeachingWeightMetadata(course.outlineVersionId);
      const keyIndexes = new Set(
        teachingWeight?.state === 'completed'
          ? teachingWeight.keyKnowledgePoints
              .filter((point) => point.lessonId === lesson.id)
              .map((point) => point.knowledgePointIndex)
          : [],
      );
      return {
        course: {
          courseId: course.id,
          outlineVersionId: course.outlineVersionId,
          title: course.title,
          courseMode: course.courseMode,
          ...(playIntent === undefined ? {} : { playIntent }),
          goals: lessonMap.map((item) => item.objective),
          lessonMap,
        },
        lesson: {
          lessonId: lesson.id,
          outlineVersionId: lesson.outlineVersionId,
          title: lesson.title,
          objective: lesson.objective,
          coreKnowledgePoints: lesson.coreKnowledgePoints.map((text, index) => ({
            ref: `knowledge:${lesson.id}:${createHash('sha256').update(text).digest('hex').slice(0, 16)}`,
            text,
            fixedImportance: keyIndexes.has(index) ? ('key' as const) : ('normal' as const),
          })),
        },
      };
    },
    async listMessages(sessionId) {
      const messages = await input.listMessages(sessionId);
      return Promise.all(
        messages.map(async (message) => ({
          messageId: message.id,
          role: message.role,
          completionStatus: message.completionStatus,
          markdown:
            (await input.artifactStore.read(message.contentArtifactRef))?.content ??
            (await input.artifactStore.readDraft(message.contentArtifactRef)) ??
            '',
          sourceRef: `message:${message.id}`,
          ...(message.generationTaskId === undefined
            ? {}
            : { generationTaskId: message.generationTaskId }),
        })),
      );
    },
    async listRelevantFinalReviews(courseId, lessonId) {
      const reviews = [];
      for await (const lesson of input.course.listLessons(courseId)) {
        if (lesson.id === lessonId) continue;
        const learning = await input.getLearningRecord(lesson.id);
        if (learning?.finalReview === undefined) continue;
        const markdown = (await input.artifactStore.read(learning.finalReview.artifactRef))
          ?.content;
        if (markdown === undefined) continue;
        reviews.push({
          sourceRef: `review:${learning.finalReview.id}`,
          version: learning.finalReview.contentSha256,
          markdown,
          selectedBecause: '同一课程中的已完成课节，可提供相关学习证据。',
        });
      }
      return reviews;
    },
    async listRelevantMaterialExcerpts(lessonId) {
      const lesson = await input.course.getLesson(lessonId);
      if (lesson === undefined) return [];
      const excerpts = [];
      for (const sourceRef of lesson.sourceRefs) {
        const material = await input.course.getMaterial(sourceRef);
        if (material === undefined) continue;
        excerpts.push({
          sourceRef,
          version: material.sha256,
          markdown: material.extractedText,
          selectedBecause: '已由当前课节的绑定版本显式引用。',
        });
      }
      return excerpts;
    },
    async getLearningStartSummary() {
      return undefined;
    },
    getPersonalizationView: input.getPersonalizationView,
  };
}
