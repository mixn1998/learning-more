import type { ProfileEvidenceCheckpointKind } from '@learning-more/contracts';

import type { LocalCourseRuntime } from './course-runtime.js';
import type { LocalProfileRuntime } from './profile-runtime.js';

type ReviewCheckpointKind = Extract<
  ProfileEvidenceCheckpointKind,
  'stage_review_finalized' | 'lesson_review_finalized'
>;

export type ReviewProfileCheckpoint = Readonly<{
  checkpointKind: ReviewCheckpointKind;
  sourceRef: string;
  markdown: string;
  courseId: string;
  lessonId: string;
  sessionId: string;
  observedAt: string;
}>;

export function createReviewProfileCheckpointCapture(input: {
  course: Pick<LocalCourseRuntime, 'access'>;
  profile: Pick<LocalProfileRuntime, 'checkpointSink' | 'recoverReasoningAnalysis'>;
}): (
  checkpoint: ReviewProfileCheckpoint,
  options?: Readonly<{ refreshReasoningAnalysis?: boolean }>,
) => Promise<void> {
  return async (checkpoint, options): Promise<void> => {
    if (checkpoint.markdown.trim() === '') return;
    const sourceGroupId = `review:${checkpoint.sourceRef}`;
    const [course, lesson] = await Promise.all([
      input.course.access.getCourse(checkpoint.courseId),
      input.course.access.getLesson(checkpoint.lessonId),
    ]);
    await input.profile.checkpointSink.capture({
      checkpointId: `profile:${checkpoint.sourceRef}:${checkpoint.checkpointKind}`,
      checkpointKind: checkpoint.checkpointKind,
      sourceType: 'review',
      sourceGroupId,
      courseId: checkpoint.courseId,
      ...(course === undefined ? {} : { courseMode: course.courseMode }),
      dependentSourceGroupIds: [`lesson:${checkpoint.lessonId}:session:${checkpoint.sessionId}`],
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
    if (options?.refreshReasoningAnalysis !== false) {
      await input.profile.recoverReasoningAnalysis();
    }
  };
}
