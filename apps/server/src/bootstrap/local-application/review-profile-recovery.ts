import type {
  LessonClosureRepository,
  ReviewStateRepository,
} from '../../modules/review-closure/interface.js';
import { reviewIdForLesson } from '../../modules/review-closure/implementation/stage-review.js';
import type { ReviewProfileCheckpoint } from './review-profile-checkpoints.js';

export async function collectRecoverableReviewProfileCheckpoints(input: {
  stageReviews: AsyncIterable<Awaited<ReturnType<ReviewStateRepository['get']>>>;
  lessonClosures: AsyncIterable<Awaited<ReturnType<LessonClosureRepository['get']>>>;
  readArtifact(artifactId: string): Promise<Readonly<{ content: string }> | undefined>;
  getCourseIdForLesson(lessonId: string): Promise<string | undefined>;
}): Promise<ReviewProfileCheckpoint[]> {
  const checkpoints: ReviewProfileCheckpoint[] = [];
  const finalizedLessonIds = new Set<string>();

  for await (const closure of input.lessonClosures) {
    if (closure === undefined || closure.state !== 'completed' || closure.review === undefined) {
      continue;
    }
    const courseId = await input.getCourseIdForLesson(closure.lessonId);
    if (courseId === undefined) continue;
    finalizedLessonIds.add(closure.lessonId);
    checkpoints.push({
      checkpointKind: 'lesson_review_finalized',
      sourceRef: `review:${reviewIdForLesson(closure.lessonId)}`,
      markdown: closure.review.markdown,
      courseId,
      lessonId: closure.lessonId,
      sessionId: closure.sessionId,
      observedAt: closure.updatedAt,
    });
  }

  for await (const review of input.stageReviews) {
    if (
      review === undefined ||
      review.status !== 'committed' ||
      review.artifactRef === undefined ||
      finalizedLessonIds.has(review.lessonId)
    ) {
      continue;
    }
    const courseId = await input.getCourseIdForLesson(review.lessonId);
    if (courseId === undefined) continue;
    const artifact = await input.readArtifact(review.artifactRef);
    if (artifact === undefined) {
      throw new Error(`REVIEW_PROFILE_RECOVERY_ARTIFACT_MISSING:${review.reviewId}`);
    }
    checkpoints.push({
      checkpointKind: 'stage_review_finalized',
      sourceRef: `review:${review.reviewId}`,
      markdown: artifact.content,
      courseId,
      lessonId: review.lessonId,
      sessionId: review.sourceSessionId,
      observedAt: review.updatedAt,
    });
  }

  return checkpoints.sort((left, right) =>
    left.observedAt === right.observedAt
      ? left.sourceRef.localeCompare(right.sourceRef)
      : left.observedAt.localeCompare(right.observedAt),
  );
}
