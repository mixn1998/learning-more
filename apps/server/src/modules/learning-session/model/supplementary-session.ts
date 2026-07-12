export type SupplementarySession = Readonly<{
  id: string;
  courseId: string;
  lessonId: string;
  sourceFinalReviewId: string;
  status: 'active' | 'archived';
  messageIds: readonly string[];
  createdAt: string;
}>;

export function createSupplementarySession(input: {
  id: string;
  courseId: string;
  lessonId: string;
  finalReviewId: string;
  createdAt: string;
}): SupplementarySession {
  return {
    id: input.id,
    courseId: input.courseId,
    lessonId: input.lessonId,
    sourceFinalReviewId: input.finalReviewId,
    status: 'active',
    messageIds: [],
    createdAt: input.createdAt,
  };
}
