import type { TransactionContext } from '../../../persistence/unit-of-work.js';

export interface LessonSession {
  readonly id: string;
  readonly lessonId: string;
  readonly status: 'active' | 'paused' | 'abandoned' | 'completed';
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly resourceVersion: number;
}

export interface LessonSessionRepository {
  get(sessionId: string): Promise<LessonSession | undefined>;
  save(tx: TransactionContext, session: LessonSession, expectedVersion: number): Promise<void>;
  list(): AsyncIterable<LessonSession>;
}
