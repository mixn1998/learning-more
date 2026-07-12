import type { TransactionContext } from '../../../persistence/unit-of-work.js';

export interface Course {
  readonly id: string;
  readonly title: string;
  readonly status: 'active' | 'closed';
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly resourceVersion: number;
}

export interface CourseListQuery {
  readonly limit?: number;
}

export interface CourseRepository {
  get(courseId: string): Promise<Course | undefined>;
  save(tx: TransactionContext, course: Course, expectedVersion: number): Promise<void>;
  list(query: CourseListQuery): AsyncIterable<Course>;
}
