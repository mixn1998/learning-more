import { createHash } from 'node:crypto';

import type { LearningFact } from '../../learning-facts/interface.js';
import type { UnitOfWork } from '../../../persistence/unit-of-work.js';
import type { CandidateEvidence, EvidenceSourceGroup, ProfileFactSource } from '../interface.js';
import type { EvidenceRepositories } from '../ports/evidence-repository.js';
import { parseCandidateEvidence, supersedeCandidateEvidence } from './candidate-evidence.js';
import { FACT_EVIDENCE_EXTRACTORS, type EvidenceDraft } from './extractors/index.js';

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function evidenceForDraft(draft: EvidenceDraft, extractorVersion: string, now: Date) {
  const normalizedRefs = [...draft.sourceRefs].sort();
  const timeBucket = draft.observedAt.slice(0, 10);
  const dedupKey = sha256(
    JSON.stringify({
      claimDimension: draft.claimDimension,
      sourceRefs: normalizedRefs,
      timeBucket,
      extractorVersion,
    }),
  );
  return parseCandidateEvidence(
    {
      ...draft,
      sourceRefs: normalizedRefs,
      evidenceId: `evidence_${dedupKey.slice(0, 40)}`,
      extractorVersion,
      dedupKey,
      status: 'active',
      resourceVersion: 0,
    },
    now,
  );
}

function sameLogicalSource(left: CandidateEvidence, right: CandidateEvidence): boolean {
  return (
    left.claimDimension === right.claimDimension &&
    left.sourceGroupId === right.sourceGroupId &&
    JSON.stringify([...left.sourceRefs].sort()) === JSON.stringify([...right.sourceRefs].sort())
  );
}

export function createProfileEvidencePipeline(options: {
  factRepository: ProfileFactSource;
  repositories: EvidenceRepositories;
  unitOfWork: UnitOfWork;
  extractorVersion: string;
  now(): Date;
  nextTransactionId(): string;
}) {
  async function currentEvidence(): Promise<CandidateEvidence[]> {
    const result: CandidateEvidence[] = [];
    for await (const item of options.repositories.evidence.list()) result.push(item);
    return result;
  }

  return {
    async processFacts(command: { limit: number }) {
      if (!Number.isInteger(command.limit) || command.limit <= 0) {
        throw new RangeError('evidence_pipeline_limit_invalid');
      }
      let processed = 0;
      let created = 0;
      let retracted = 0;
      let rejected = 0;
      for (const extractor of FACT_EVIDENCE_EXTRACTORS) {
        const checkpointId = `checkpoint_${extractor.sourceGroup}`;
        const checkpoint = await options.repositories.checkpoints.get(checkpointId);
        const facts = [];
        let afterCheckpoint =
          checkpoint?.extractorVersion !== options.extractorVersion ||
          checkpoint.lastFactId === undefined;
        for await (const fact of options.factRepository.list()) {
          if (!afterCheckpoint) {
            if (fact.factId === checkpoint?.lastFactId) afterCheckpoint = true;
            continue;
          }
          if (facts.length < command.limit) facts.push(fact);
        }
        if (facts.length === 0) continue;

        const preparedFacts: Array<{
          fact: LearningFact;
          drafts: readonly EvidenceDraft[];
        }> = [];
        let rejectedRecord:
          | Readonly<{
              rejectionId: string;
              factId: string;
              sourceGroup: EvidenceSourceGroup;
              extractorVersion: string;
              errorCode: string;
              rejectedAt: string;
              resourceVersion: number;
            }>
          | undefined;
        for (const fact of facts) {
          try {
            preparedFacts.push({ fact, drafts: extractor.extract(fact) });
          } catch (error) {
            const rejectionId = `rejection_${sha256(
              `${extractor.sourceGroup}:${fact.factId}:${options.extractorVersion}`,
            ).slice(0, 40)}`;
            rejectedRecord = {
              rejectionId,
              factId: fact.factId,
              sourceGroup: extractor.sourceGroup,
              extractorVersion: options.extractorVersion,
              errorCode: error instanceof Error ? error.message : 'evidence_extraction_invalid',
              rejectedAt: fact.recordedAt,
              resourceVersion: 1,
            };
            break;
          }
        }

        const existing = await currentEvidence();
        const updates = new Map<string, CandidateEvidence>();
        const additions: CandidateEvidence[] = [];
        for (const { fact, drafts } of preparedFacts) {
          const supersedesFactId =
            typeof fact.payload.supersedesFactId === 'string'
              ? fact.payload.supersedesFactId
              : undefined;
          if (supersedesFactId !== undefined) {
            for (const item of existing) {
              if (
                item.status === 'active' &&
                item.sourceRefs.includes(`fact:${supersedesFactId}`)
              ) {
                updates.set(item.evidenceId, { ...item, status: 'retracted' });
              }
            }
          }
          for (const draft of drafts) {
            const candidate = evidenceForDraft(draft, options.extractorVersion, options.now());
            if (
              (await options.repositories.evidence.findByDedupKey(candidate.dedupKey)) !== undefined
            )
              continue;
            const previous = existing.find(
              (item) => item.status === 'active' && sameLogicalSource(item, candidate),
            );
            if (
              previous !== undefined &&
              previous.extractorVersion !== candidate.extractorVersion
            ) {
              const superseded = supersedeCandidateEvidence(previous, candidate);
              updates.set(previous.evidenceId, superseded.previous);
            }
            additions.push(candidate);
          }
        }
        const finalFact = preparedFacts.at(-1)?.fact;
        const statusChecksum = sha256(
          JSON.stringify(
            [...existing, ...additions]
              .map((item) => updates.get(item.evidenceId) ?? item)
              .filter((item) => item.sourceGroup === extractor.sourceGroup)
              .map((item) => `${item.evidenceId}:${item.status}`)
              .sort(),
          ),
        );
        await options.unitOfWork.execute(
          { transactionId: options.nextTransactionId() },
          async (tx) => {
            if (
              rejectedRecord !== undefined &&
              (await options.repositories.rejections.get(rejectedRecord.rejectionId)) === undefined
            ) {
              await options.repositories.rejections.save(tx, rejectedRecord);
            }
            for (const update of [...updates.values()].sort((a, b) =>
              a.evidenceId.localeCompare(b.evidenceId),
            )) {
              await options.repositories.evidence.save(tx, update, update.resourceVersion);
            }
            for (const candidate of additions.sort((a, b) =>
              a.evidenceId.localeCompare(b.evidenceId),
            )) {
              await options.repositories.evidence.save(tx, candidate, 0);
            }
            if (finalFact !== undefined) {
              await options.repositories.checkpoints.save(
                tx,
                {
                  checkpointId,
                  sourceGroup: extractor.sourceGroup as EvidenceSourceGroup,
                  lastFactId: finalFact.factId,
                  extractorVersion: options.extractorVersion,
                  outputChecksum: statusChecksum,
                  processedFactCount: (checkpoint?.processedFactCount ?? 0) + preparedFacts.length,
                  rejectedFactCount:
                    (checkpoint?.rejectedFactCount ?? 0) + (rejectedRecord === undefined ? 0 : 1),
                  updatedAt: options.now().toISOString(),
                  resourceVersion: checkpoint?.resourceVersion ?? 0,
                },
                checkpoint?.resourceVersion ?? 0,
              );
            }
          },
        );
        processed += preparedFacts.length;
        created += additions.length;
        retracted += [...updates.values()].filter((item) => item.status === 'retracted').length;
        if (rejectedRecord !== undefined) rejected += 1;
      }
      return { processed, created, retracted, rejected };
    },
  };
}
