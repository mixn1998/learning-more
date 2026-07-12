import { createHash } from 'node:crypto';

import type { LearningEventEnvelope } from '@learning-more/contracts';

import type { UnitOfWork } from '../../../persistence/unit-of-work.js';
import type { FactRepository } from '../ports/fact-repository.js';
import { eventToFacts } from './event-to-fact.js';

export function createFactProjector(options: {
  repository: FactRepository;
  unitOfWork: UnitOfWork;
}) {
  let ignored = 0;
  return {
    async project(event: LearningEventEnvelope) {
      const facts = eventToFacts(event);
      if (facts.length === 0) {
        ignored += 1;
        return { appended: 0, duplicates: 0, ignored: 1 };
      }
      let appended = 0;
      let duplicates = 0;
      const transactionId = `tx_facts_${createHash('sha256')
        .update(event.id, 'utf8')
        .digest('hex')}`;
      await options.unitOfWork.execute({ transactionId }, async (tx) => {
        for (const fact of facts) {
          const result = await options.repository.append(tx, fact);
          if (result === 'appended') appended += 1;
          else duplicates += 1;
        }
      });
      return { appended, duplicates, ignored: 0 };
    },
    ignoredCount: () => ignored,
  };
}
