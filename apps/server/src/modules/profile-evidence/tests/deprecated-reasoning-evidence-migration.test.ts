import { describe, expect, it } from 'vitest';

import { parseCandidateEvidence } from '../implementation/candidate-evidence.js';
import { purgeDeprecatedReasoningEvidence } from '../implementation/deprecated-reasoning-evidence-migration.js';
import { createInMemoryEvidenceRepositories } from '../ports/evidence-repository.js';

function candidate(input: { evidenceId: string; extractorVersion: string; dedupKey: string }) {
  return parseCandidateEvidence(
    {
      evidenceId: input.evidenceId,
      claimDimension: 'thinking_tendency.dynamic_dimension',
      summary: 'A bounded reasoning observation.',
      sourceGroup: 'behavior',
      sourceGroupId: 'session:session_01',
      dependentSourceGroupIds: [],
      sourceRefs: ['message:message_01'],
      dataKeys: ['user_profile.reasoning_episode.source_refs'],
      observedAt: '2026-07-17T00:00:00.000Z',
      strength: { score: 2, rationale: 'Bounded local evidence.' },
      polarity: 'supporting',
      extractorVersion: input.extractorVersion,
      dedupKey: input.dedupKey,
      status: 'active',
      resourceVersion: 0,
    },
    new Date('2026-07-17T00:00:00.000Z'),
  );
}

describe('deprecated reasoning evidence migration', () => {
  it('purges only unreferenced reasoning-evidence@1 projections and is idempotent', async () => {
    const repositories = createInMemoryEvidenceRepositories();
    const unitOfWork = {
      async execute<T>(
        _request: unknown,
        work: (tx: {
          stageJson(): Promise<void>;
          stageText(): Promise<void>;
          deleteOnCommit(): Promise<void>;
        }) => Promise<T>,
      ) {
        return work({
          stageJson: async () => undefined,
          stageText: async () => undefined,
          deleteOnCommit: async () => undefined,
        });
      },
    };
    const unreferenced = candidate({
      evidenceId: 'evidence_legacy_unreferenced',
      extractorVersion: 'reasoning-analyzer@1:reasoning-evidence@1',
      dedupKey: 'a'.repeat(64),
    });
    const referenced = candidate({
      evidenceId: 'evidence_legacy_referenced',
      extractorVersion: 'reasoning-analyzer@1:reasoning-evidence@1',
      dedupKey: 'b'.repeat(64),
    });
    const current = candidate({
      evidenceId: 'evidence_current',
      extractorVersion: 'reasoning-global-analyzer@2:reasoning-session-dimension@2',
      dedupKey: 'c'.repeat(64),
    });
    await unitOfWork.execute({ transactionId: 'tx_seed' }, async (tx) => {
      await repositories.evidence.save(tx, unreferenced, 0);
      await repositories.evidence.save(tx, referenced, 0);
      await repositories.evidence.save(tx, current, 0);
    });

    await expect(
      purgeDeprecatedReasoningEvidence({
        evidenceRepository: repositories.evidence,
        referencedEvidenceIds: new Set([referenced.evidenceId]),
        unitOfWork,
        nextTransactionId: () => 'tx_migrate',
      }),
    ).resolves.toEqual({ deleted: 1, retainedReferenced: 1 });
    await expect(repositories.evidence.get(unreferenced.evidenceId)).resolves.toBeUndefined();
    await expect(repositories.evidence.get(referenced.evidenceId)).resolves.toBeDefined();
    await expect(repositories.evidence.get(current.evidenceId)).resolves.toBeDefined();

    await expect(
      purgeDeprecatedReasoningEvidence({
        evidenceRepository: repositories.evidence,
        referencedEvidenceIds: new Set([referenced.evidenceId]),
        unitOfWork,
        nextTransactionId: () => 'tx_migrate_again',
      }),
    ).resolves.toEqual({ deleted: 0, retainedReferenced: 1 });
  });
});
