import type { CourseMode } from './commands.js';
import type { StoredNextLessonRecommendation } from '../../next-lesson/interface.js';

export interface CourseAggregate {
  readonly id: string;
  readonly title: string;
  readonly courseMode: CourseMode;
  readonly outlineVersionId: string;
  readonly lessonIds: readonly string[];
  readonly recommendedLessonId?: string;
  readonly nextLessonRecommendation?: StoredNextLessonRecommendation;
  readonly status: 'active' | 'closed';
  readonly closedAt?: string;
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
