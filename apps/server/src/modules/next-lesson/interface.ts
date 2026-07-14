export type NextLessonCandidate = Readonly<{
  semanticKey: string;
  title: string;
  objective: string;
  prerequisiteSemanticKeys: readonly string[];
  estimatedMinutes: number;
  progress?: 'not_started' | 'in_progress' | 'abandoned' | 'completed';
  courseStatus?: 'active' | 'closed';
  available?: boolean;
  activeSession?: boolean;
  scheduledStartAt?: string;
  evidenceRefs?: readonly string[];
}>;

import type { NextLessonRecommendationVersion } from './model/next-lesson-recommendation.js';

export type {
  NextLessonRecommendationStatus,
  NextLessonRecommendationVersion,
  StoredNextLessonRecommendation,
} from './model/next-lesson-recommendation.js';
export { resolveNextLessonRecommendation } from './implementation/recommendation-policy.js';

export interface NextLessonRecommender {
  recommend(
    input: Readonly<{
      courseId: string;
      trigger: 'course-confirmed' | 'outline-revised' | 'lesson-completed' | 'schedule-changed';
      candidates: readonly NextLessonCandidate[];
      completedSemanticKeys: readonly string[];
      currentFinalReviewMarkdown?: string;
      planSummary?: string;
      previousRecommendation?: NextLessonRecommendationVersion;
    }>,
  ): Promise<NextLessonRecommendationVersion>;
}
