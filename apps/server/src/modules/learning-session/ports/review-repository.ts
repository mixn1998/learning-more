import type { TransactionContext } from '../../../persistence/unit-of-work.js';

export interface Review {
  readonly id: string;
  readonly lessonId: string;
  readonly status: 'stage' | 'final';
  readonly artifactId: string;
  readonly immutable: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly resourceVersion: number;
}

export interface ReviewRepository {
  get(reviewId: string): Promise<Review | undefined>;
  save(tx: TransactionContext, review: Review, expectedVersion: number): Promise<void>;
  list(): AsyncIterable<Review>;
}
