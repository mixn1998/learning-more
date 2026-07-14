import type { CourseMode, TeachingObservation } from '@learning-more/contracts';

export interface ReasoningBehaviorSink {
  captureFromObservation(input: {
    courseId: string;
    courseMode: CourseMode;
    observation: TeachingObservation;
  }): Promise<unknown>;
}
