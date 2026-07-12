import type { LearningFact, ReadModelStatus } from '../../interface.js';
import { actualSeconds, createFactAccumulator, status } from './shared.js';

type CourseSummary = Readonly<{
  courseId: string;
  status: 'active' | 'closed';
  createdAt?: string;
  closedAt?: string;
  completedLessonCount: number;
  actualSeconds: number;
  finalReviewCount: number;
}>;

export type CourseSummaryView = ReadModelStatus & Readonly<{ courses: readonly CourseSummary[] }>;

export function createCourseSummaryProjection() {
  const accumulator = createFactAccumulator();
  return {
    apply: accumulator.apply,
    view(): CourseSummaryView {
      const facts = accumulator.facts();
      const courses = new Map<string, CourseSummary>();
      const ensure = (courseId: string): CourseSummary => {
        const current = courses.get(courseId) ?? {
          courseId,
          status: 'active',
          completedLessonCount: 0,
          actualSeconds: 0,
          finalReviewCount: 0,
        };
        courses.set(courseId, current);
        return current;
      };
      for (const fact of facts) {
        const courseId = fact.subjectRefs.courseId;
        if (courseId === undefined) continue;
        const current = ensure(courseId);
        if (fact.factType === 'CourseCreatedFact') {
          courses.set(courseId, { ...current, createdAt: fact.occurredAt });
        } else if (fact.factType === 'CourseClosedFact') {
          courses.set(courseId, { ...current, status: 'closed', closedAt: fact.occurredAt });
        } else if (fact.factType === 'LessonCompletedFact') {
          courses.set(courseId, {
            ...current,
            completedLessonCount: current.completedLessonCount + 1,
            actualSeconds: current.actualSeconds + actualSeconds(fact),
          });
        } else if (fact.factType === 'ReviewFinalizedFact') {
          courses.set(courseId, { ...current, finalReviewCount: current.finalReviewCount + 1 });
        }
      }
      return {
        ...status(facts),
        courses: [...courses.values()].sort((left, right) =>
          left.courseId.localeCompare(right.courseId),
        ),
      };
    },
  };
}
