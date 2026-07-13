import type { TransactionContext } from '../../../persistence/unit-of-work.js';
import type { LearningFact } from '../interface.js';

export interface FactRepository {
  get(factId: string): Promise<LearningFact | undefined>;
  append(
    tx: TransactionContext,
    fact: LearningFact,
  ): Promise<'appended' | 'duplicate' | 'ignored_deleted_course'>;
  retractCourse(tx: TransactionContext, courseId: string): Promise<number>;
  list(): AsyncIterable<LearningFact>;
}

export function createInMemoryFactRepository(): FactRepository {
  const facts = new Map<string, LearningFact>();
  return {
    get: async (factId) => structuredClone(facts.get(factId)),
    async append(_tx, fact) {
      const existing = facts.get(fact.factId);
      if (existing !== undefined) {
        if (
          existing.sourceEventId !== fact.sourceEventId ||
          existing.factType !== fact.factType ||
          JSON.stringify(existing) !== JSON.stringify(fact)
        ) {
          throw new Error('FACT_ID_COLLISION');
        }
        return 'duplicate';
      }
      facts.set(fact.factId, structuredClone(fact));
      return 'appended';
    },
    async retractCourse(_tx, courseId) {
      let retracted = 0;
      for (const [factId, fact] of facts) {
        if (fact.subjectRefs.courseId !== courseId) continue;
        facts.delete(factId);
        retracted += 1;
      }
      return retracted;
    },
    async *list() {
      for (const fact of [...facts.values()].sort((left, right) =>
        left.occurredAt === right.occurredAt
          ? left.factId.localeCompare(right.factId)
          : left.occurredAt.localeCompare(right.occurredAt),
      )) {
        yield structuredClone(fact);
      }
    },
  };
}
