import type { UnitOfWork } from '../../../persistence/unit-of-work.js';
import type { CandidateEvidence } from '../interface.js';
import type { CandidateEvidenceRepository } from '../ports/evidence-repository.js';

const DEPRECATED_REASONING_PROJECTION = ':reasoning-evidence@1';

function isDeprecatedReasoningProjection(extractorVersion: string): boolean {
  return extractorVersion.endsWith(DEPRECATED_REASONING_PROJECTION);
}

export async function purgeDeprecatedReasoningEvidence(options: {
  evidenceRepository: CandidateEvidenceRepository;
  referencedEvidenceIds: ReadonlySet<string>;
  unitOfWork: UnitOfWork;
  nextTransactionId(): string;
}): Promise<Readonly<{ deleted: number; retainedReferenced: number }>> {
  const deletions: CandidateEvidence[] = [];
  let retainedReferenced = 0;
  for await (const candidate of options.evidenceRepository.list()) {
    if (!isDeprecatedReasoningProjection(candidate.extractorVersion)) continue;
    if (options.referencedEvidenceIds.has(candidate.evidenceId)) {
      retainedReferenced += 1;
      continue;
    }
    deletions.push(candidate);
  }
  if (deletions.length === 0) return { deleted: 0, retainedReferenced };

  await options.unitOfWork.execute({ transactionId: options.nextTransactionId() }, async (tx) => {
    for (const candidate of deletions) {
      await options.evidenceRepository.delete(tx, candidate.evidenceId, candidate.resourceVersion);
    }
  });
  return { deleted: deletions.length, retainedReferenced };
}
