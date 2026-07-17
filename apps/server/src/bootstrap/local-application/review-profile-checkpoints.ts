import type { ProfileEvidenceCheckpointKind } from '@learning-more/contracts';

import type { LocalCourseRuntime } from './course-runtime.js';
import type { LocalLearningRuntime } from './learning-runtime.js';
import type { LocalProfileRuntime } from './profile-runtime.js';

type ReviewCheckpointKind = Extract<
  ProfileEvidenceCheckpointKind,
  'stage_review_finalized' | 'lesson_review_finalized'
>;

export function createReviewProfileCheckpointCapture(input: {
  course: Pick<LocalCourseRuntime, 'access'>;
  learning: Pick<LocalLearningRuntime, 'access'>;
  profile: Pick<LocalProfileRuntime, 'checkpointSink' | 'recoverReasoningAnalysis'>;
}): (checkpoint: {
  checkpointKind: ReviewCheckpointKind;
  sourceRef: string;
  markdown: string;
  courseId: string;
  lessonId: string;
  observedAt: string;
}) => Promise<void> {
  return async (checkpoint): Promise<void> => {
    if (checkpoint.markdown.trim() === '') return;
    const sourceGroupId = `review:${checkpoint.sourceRef}`;
    const [course, lesson, learning] = await Promise.all([
      input.course.access.getCourse(checkpoint.courseId),
      input.course.access.getLesson(checkpoint.lessonId),
      input.learning.access.getRecord(checkpoint.lessonId),
    ]);
    const sessionId = learning?.learning.session?.id;
    await input.profile.checkpointSink.capture({
      checkpointId: `profile:${checkpoint.sourceRef}:${checkpoint.checkpointKind}`,
      checkpointKind: checkpoint.checkpointKind,
      sourceType: 'review',
      sourceGroupId,
      courseId: checkpoint.courseId,
      ...(course === undefined ? {} : { courseMode: course.courseMode }),
      dependentSourceGroupIds:
        sessionId === undefined ? [] : [`lesson:${checkpoint.lessonId}:session:${sessionId}`],
      ...(course === undefined ? {} : { courseContext: course.title }),
      ...(lesson === undefined ? {} : { lessonContext: `${lesson.title}｜${lesson.objective}` }),
      completeness: 'complete',
      sources: [
        {
          sourceRef: checkpoint.sourceRef,
          sourceGroupId,
          sourceType: 'review',
          role: 'review',
          excerpt: checkpoint.markdown.slice(0, 4_000),
          observedAt: checkpoint.observedAt,
        },
      ],
    });
    await input.profile.recoverReasoningAnalysis();
  };
}
