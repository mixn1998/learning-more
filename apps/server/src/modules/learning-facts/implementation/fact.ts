import { createHash } from 'node:crypto';

import type { DataKey, LearningEventEnvelope } from '@learning-more/contracts';

import type { LearningFact, LearningFactType } from '../interface.js';

export function createLearningFact(input: {
  event: LearningEventEnvelope;
  factType: LearningFactType;
  dataKeys: readonly DataKey[];
}): LearningFact {
  const identity = `${input.event.id}\0${input.factType}`;
  return {
    factId: `fact_${createHash('sha256').update(identity, 'utf8').digest('hex').slice(0, 40)}`,
    factType: input.factType,
    subjectRefs: { ...input.event.target_refs },
    occurredAt: input.event.occurred_at,
    recordedAt: input.event.recorded_at,
    sourceEventId: input.event.id,
    dataKeys: input.dataKeys,
    payload: { ...input.event.payload },
    schemaVersion: 1,
  };
}
