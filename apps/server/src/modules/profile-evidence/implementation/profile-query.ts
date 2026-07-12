import type { FactRepository } from '../../learning-facts/ports/fact-repository.js';
import type { CandidateEvidenceRepository } from '../ports/evidence-repository.js';
import type { ProfileWindow } from './global-learning-profile.js';
import { createGlobalLearningProfileProjection } from './profile-projection.js';

export async function queryGlobalLearningProfile(options: {
  factRepository: FactRepository;
  evidenceRepository: CandidateEvidenceRepository;
  timeZone: string;
  window: ProfileWindow;
}) {
  const projection = createGlobalLearningProfileProjection({
    timeZone: options.timeZone,
    window: options.window,
  });
  const facts = [];
  for await (const fact of options.factRepository.list()) facts.push(fact);
  projection.applyFacts(facts);
  const evidence = [];
  for await (const candidate of options.evidenceRepository.list()) evidence.push(candidate);
  projection.applyEvidence(evidence);
  return projection.view();
}
