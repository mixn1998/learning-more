import type { CourseMode } from './commands.js';

export interface CourseAggregate {
  readonly id: string;
  readonly title: string;
  readonly courseMode: CourseMode;
  readonly outlineVersionId: string;
  readonly lessonIds: readonly string[];
  readonly recommendedLessonId: string;
  readonly status: 'active' | 'closed';
  readonly createdAt: string;
  readonly resourceVersion: number;
}

export interface ConfirmedOutlineVersion {
  readonly id: string;
  readonly courseId: string;
  readonly sourceCandidateVersionId: string;
  readonly outlineMarkdown: string;
  readonly disciplineTag: string;
  readonly topicTags: readonly string[];
  readonly createdAt: string;
  readonly resourceVersion: number;
}
