import type { TeachingObservation } from '@learning-more/contracts';

export interface TeachingInteractionSink {
  captureFromObservation(input: {
    courseId: string;
    lessonId: string;
    sessionId: string;
    observation: TeachingObservation;
  }): Promise<void>;
}
