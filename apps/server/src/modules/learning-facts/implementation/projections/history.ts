import type { LearningFact, ReadModelStatus } from '../../interface.js';
import { createFactAccumulator, status } from './shared.js';

export type HistoryView = ReadModelStatus &
  Readonly<{
    entries: readonly Readonly<{
      factId: string;
      factType: LearningFact['factType'];
      occurredAt: string;
      subjectRefs: Readonly<Record<string, string>>;
      payload: Readonly<Record<string, unknown>>;
    }>[];
  }>;

export function createHistoryProjection() {
  const accumulator = createFactAccumulator();
  return {
    apply: accumulator.apply,
    view(): HistoryView {
      const facts = accumulator.facts();
      return {
        ...status(facts),
        entries: facts.map((fact) => ({
          factId: fact.factId,
          factType: fact.factType,
          occurredAt: fact.occurredAt,
          subjectRefs: fact.subjectRefs,
          payload: fact.payload,
        })),
      };
    },
  };
}
