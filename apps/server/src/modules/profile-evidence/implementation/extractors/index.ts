import type { DataKey } from '@learning-more/contracts';

import type { LearningFact, LearningFactType } from '../../../learning-facts/interface.js';
import type { EvidenceSourceGroup } from '../../interface.js';
import { extractBehaviorEvidence } from './behavior.js';
import { extractOutcomeEvidence } from './outcome.js';
import { extractReflectionEvidence } from './reflection.js';

export type EvidenceDraft = Readonly<{
  claimDimension: string;
  summary: string;
  sourceGroup: EvidenceSourceGroup;
  sourceGroupId: string;
  dependentSourceGroupIds: readonly string[];
  sourceFactType: LearningFactType;
  sourceRefs: readonly string[];
  dataKeys: readonly DataKey[];
  observedAt: string;
  strength: Readonly<{ score: 1 | 2 | 3; rationale: string }>;
  polarity: 'supporting' | 'limiting' | 'contradicting';
}>;

export type EvidenceExtractor = Readonly<{
  sourceGroup: EvidenceSourceGroup;
  extract(fact: LearningFact): readonly EvidenceDraft[];
}>;

export const FACT_EVIDENCE_EXTRACTORS: readonly EvidenceExtractor[] = [
  { sourceGroup: 'behavior', extract: extractBehaviorEvidence },
  { sourceGroup: 'outcome', extract: extractOutcomeEvidence },
  { sourceGroup: 'review', extract: extractReflectionEvidence },
];
