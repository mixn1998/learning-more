import { randomUUID } from 'node:crypto';

import type { ReviewDocument } from '@learning-more/contracts';

import { teachingPlayIntent } from '../../modules/interactive-teaching/implementation/teaching-play-intent.js';
import { createCourseReviewWorkflow } from '../../modules/review-closure/implementation/course-review.js';
import type { createGenerationReviewWriter } from '../../modules/review-closure/implementation/generation-review-writer.js';
import type { CourseReviewInputManifest } from '../../modules/review-closure/interface.js';
import type { createMarkdownArtifactStore } from '../../persistence/markdown-artifact-store.js';
import type { createLocalFileReviewClosureRepositories } from '../../persistence/review-closure-repositories.js';
import type { UnitOfWork } from '../../persistence/unit-of-work.js';
import type { LocalCourseRuntime } from './course-runtime.js';
import type { LocalEventFactsRuntime } from './event-facts-runtime.js';
import type { LocalLearningRuntime } from './learning-runtime.js';

export function createLocalCourseReviewRuntime(input: {
  repositories: ReturnType<typeof createLocalFileReviewClosureRepositories>;
  unitOfWork: UnitOfWork;
  artifactStore: ReturnType<typeof createMarkdownArtifactStore>;
  course: LocalCourseRuntime;
  learning: LocalLearningRuntime;
  events: LocalEventFactsRuntime;
  reviewWriter: ReturnType<typeof createGenerationReviewWriter>;
  assertEvidenceRefs(
    document: ReviewDocument | undefined,
    expectedKind: ReviewDocument['kind'],
    allowedRefs: ReadonlySet<string>,
  ): void;
}) {
  const reviews = createCourseReviewWorkflow({
    repository: input.repositories.courseReviews,
    unitOfWork: input.unitOfWork,
    reviewTask: {
      async submit(reviewInput) {
        const course = await input.course.access.getCourse(reviewInput.courseId);
        if (course === undefined) throw new Error('course_review_course_not_found');
        const lessons = [];
        const finalReviewLessonByRef = new Map<string, string>();
        for await (const lesson of input.course.access.listLessons(reviewInput.courseId)) {
          lessons.push({
            lessonId: lesson.id,
            title: lesson.title,
            objective: lesson.objective,
            coreKnowledgePoints: lesson.coreKnowledgePoints,
          });
          const learning = await input.learning.access.getRecord(lesson.id);
          if (learning?.finalReview !== undefined) {
            finalReviewLessonByRef.set(learning.finalReview.artifactRef, lesson.id);
          }
        }
        const lessonReviews = [];
        for (const sourceRef of reviewInput.inputManifest.completedFinalReviewRefs) {
          const lessonId = finalReviewLessonByRef.get(sourceRef);
          const markdown = (await input.artifactStore.read(sourceRef))?.content;
          if (lessonId === undefined || markdown === undefined) {
            throw new Error('course_review_evidence_pack_incomplete');
          }
          lessonReviews.push({ lessonId, kind: 'final' as const, sourceRef, markdown });
        }
        for (const reviewId of reviewInput.inputManifest.abandonedStageReviewRefs) {
          const stageReview = await input.repositories.stageReviews.get(reviewId);
          const artifactRef = stageReview?.artifactRef;
          const markdown =
            artifactRef === undefined
              ? undefined
              : (await input.artifactStore.read(artifactRef))?.content;
          if (stageReview === undefined || artifactRef === undefined || markdown === undefined) {
            throw new Error('course_review_evidence_pack_incomplete');
          }
          lessonReviews.push({
            lessonId: stageReview.lessonId,
            kind: 'stage' as const,
            sourceRef: artifactRef,
            markdown,
          });
        }
        const playIntent = teachingPlayIntent(course.courseMode);
        return input.reviewWriter.submitCourse(
          {
            kind: 'course',
            course: {
              courseId: course.id,
              title: course.title,
              outlineVersionId: reviewInput.inputManifest.outlineVersionId,
            },
            lessons,
            lessonReviews,
            abandonedWithoutReviewLessonIds:
              reviewInput.inputManifest.abandonedWithoutReviewLessonIds,
            ...(playIntent === undefined ? {} : { reviewLens: playIntent }),
          },
          reviewInput.commandId,
        );
      },
    },
    outbox: input.events.outbox,
    nextEventId: () => `event_${randomUUID()}`,
    now: () => new Date(),
    assertCourseWritable: input.course.access.assertCourseWritable,
  });
  const activeFinalizations = new Map<string, Promise<void>>();

  async function buildInputManifest(courseId: string): Promise<CourseReviewInputManifest> {
    const course = await input.course.access.getCourse(courseId);
    if (course === undefined) throw new Error('course_review_course_not_found');
    const completedFinalReviewRefs: string[] = [];
    const abandonedStageReviewRefs: string[] = [];
    const abandonedWithoutReviewLessonIds: string[] = [];
    for (const lessonId of course.lessonIds) {
      const record = await input.learning.access.getRecord(lessonId);
      if (record?.finalReview !== undefined) {
        completedFinalReviewRefs.push(record.finalReview.artifactRef);
      } else if (
        record?.learning.progress === 'abandoned' &&
        record.learning.session?.stageReviewId !== undefined
      ) {
        abandonedStageReviewRefs.push(record.learning.session.stageReviewId);
      } else if (record?.learning.progress === 'abandoned') {
        abandonedWithoutReviewLessonIds.push(lessonId);
      }
    }
    return {
      outlineVersionId: course.outlineVersionId,
      completedFinalReviewRefs,
      abandonedStageReviewRefs,
      abandonedWithoutReviewLessonIds,
    };
  }

  async function isReadyForPregeneratedReview(courseId: string): Promise<boolean> {
    const course = await input.course.access.getCourse(courseId);
    if (course === undefined || course.lessonIds.length === 0) return false;
    for (const lessonId of course.lessonIds) {
      const record = await input.learning.access.getRecord(lessonId);
      if (record?.learning.progress !== 'completed' || record.finalReview === undefined) {
        return false;
      }
    }
    return true;
  }

  async function allowedEvidenceRefs(manifest: CourseReviewInputManifest): Promise<Set<string>> {
    const refs = new Set<string>([
      ...manifest.completedFinalReviewRefs,
      ...manifest.abandonedStageReviewRefs,
    ]);
    for (const reviewId of manifest.abandonedStageReviewRefs) {
      const stageReview = await input.repositories.stageReviews.get(reviewId);
      if (stageReview?.artifactRef !== undefined) refs.add(stageReview.artifactRef);
    }
    return refs;
  }

  function scheduleFinalization(courseId: string): Promise<void> {
    const active = activeFinalizations.get(courseId);
    if (active !== undefined) return active;
    const finalization = (async () => {
      try {
        let current = await input.repositories.courseReviews.get(courseId);
        if (current === undefined) return;
        if (current.state === 'generating-review') {
          if (current.generationTaskId === undefined) {
            throw new Error('course_review_generation_task_missing');
          }
          const generated = await input.reviewWriter.complete(current.generationTaskId);
          input.assertEvidenceRefs(
            generated.document,
            'course-final',
            await allowedEvidenceRefs(current.inputManifest),
          );
          const artifactRef = `course_review_${courseId}_${current.inputManifest.outlineVersionId}`;
          const existingArtifact = await input.artifactStore.read(artifactRef);
          if (existingArtifact === undefined) {
            await input.artifactStore.finalize({
              artifactId: artifactRef,
              kind: 'course-review',
              content: generated.markdown,
              immutable: true,
            });
          } else if (existingArtifact.contentSha256 !== generated.contentSha256) {
            throw new Error('course_review_artifact_conflict');
          }
          current = await reviews.markReady(
            courseId,
            artifactRef,
            generated.contentSha256,
            generated.document,
          );
        }
        if (current.state !== 'review-ready' || current.artifactRef === undefined) return;
        const artifact = await input.artifactStore.read(current.artifactRef);
        if (artifact === undefined) throw new Error('course_review_artifact_missing');
        await reviews.finalize(
          courseId,
          `auto_finalize_course_review_${courseId}_${current.inputManifest.outlineVersionId}`,
        );
      } catch (error) {
        const current = await input.repositories.courseReviews.get(courseId);
        if (
          current === undefined ||
          current.state === 'review-finalized' ||
          current.state === 'review-failed'
        ) {
          return;
        }
        await reviews.fail(
          courseId,
          error instanceof Error && error.message.trim() !== ''
            ? error.message.slice(0, 200)
            : 'course_review_generation_failed',
          current.draftArtifactRef ?? `draft_${current.generationTaskId ?? courseId}`,
        );
      }
    })()
      .catch(() => undefined)
      .finally(() => activeFinalizations.delete(courseId));
    activeFinalizations.set(courseId, finalization);
    return finalization;
  }

  function triggerPregeneration(courseId: string): void {
    void (async () => {
      if (!(await isReadyForPregeneratedReview(courseId))) return;
      const manifest = await buildInputManifest(courseId);
      const review = await reviews.request(
        courseId,
        manifest,
        `auto_generate_course_review_${courseId}_${manifest.outlineVersionId}`,
      );
      if (review.state === 'generating-review' || review.state === 'review-ready') {
        void scheduleFinalization(courseId);
      }
    })().catch(() => undefined);
  }

  return { reviews, buildInputManifest, scheduleFinalization, triggerPregeneration };
}
