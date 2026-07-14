import type {
  CourseMode,
  PersonalizationView,
  TeachingStateSnapshot,
} from '@learning-more/contracts';

import type { MaterializedTeachingMessage } from '../interface.js';

export type { MaterializedTeachingMessage } from '../interface.js';

export type SourceExcerpt = Readonly<{
  sourceRef: string;
  version: string;
  markdown: string;
  selectedBecause: string;
}>;

export type CourseLessonTeachingContext = Readonly<{
  course: Readonly<{
    courseId: string;
    outlineVersionId: string;
    title: string;
    courseMode: CourseMode;
    playIntent?: string;
    goals: readonly string[];
    lessonMap: readonly Readonly<{
      lessonId: string;
      title: string;
      objective: string;
      relation: 'current' | 'prerequisite' | 'other';
    }>[];
  }>;
  lesson: Readonly<{
    lessonId: string;
    outlineVersionId: string;
    title: string;
    objective: string;
    coreKnowledgePoints: readonly Readonly<{ ref: string; text: string }>[];
  }>;
}>;

export type TeachingContextPackage = Readonly<{
  schemaVersion: 1;
  course: CourseLessonTeachingContext['course'];
  lesson: CourseLessonTeachingContext['lesson'];
  learningStartSummary?: string;
  relevantFinalReviews: readonly SourceExcerpt[];
  readingMaterialExcerpts: readonly SourceExcerpt[];
  personalization: PersonalizationView;
  teachingState: TeachingStateSnapshot;
  recentMessages: readonly MaterializedTeachingMessage[];
  unobservedMessages: readonly MaterializedTeachingMessage[];
}>;

export interface TeachingContextSources {
  getCourseAndLesson(input: {
    courseId: string;
    lessonId: string;
  }): Promise<CourseLessonTeachingContext>;
  listMessages(sessionId: string): Promise<readonly MaterializedTeachingMessage[]>;
  listRelevantFinalReviews(courseId: string, lessonId: string): Promise<readonly SourceExcerpt[]>;
  listRelevantMaterialExcerpts(lessonId: string): Promise<readonly SourceExcerpt[]>;
  getLearningStartSummary(courseId: string): Promise<string | undefined>;
  getPersonalizationView(input: {
    courseId: string;
    lessonId: string;
  }): Promise<PersonalizationView>;
}

export interface TeachingContextAssembler {
  assemble(input: {
    courseId: string;
    lessonId: string;
    sessionId: string;
    currentUserMessageId: string;
    teachingState: TeachingStateSnapshot;
    unobservedMessageIds: readonly string[];
  }): Promise<TeachingContextPackage>;
}
