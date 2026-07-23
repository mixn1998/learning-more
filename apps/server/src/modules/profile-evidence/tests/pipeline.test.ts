import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';

import { DataRoot } from '../../../persistence/data-root.js';
import { createLocalFileFactRepository } from '../../../persistence/learning-facts-repositories.js';
import { createStorePaths, initializeStoreLayout } from '../../../persistence/paths.js';
import { createLocalFileEvidenceRepositories } from '../../../persistence/profile-evidence-repositories.js';
import { recoverTransactions } from '../../../persistence/recover-transactions.js';
import { createUnitOfWork } from '../../../persistence/unit-of-work.js';
import type { LearningFact, LearningFactType } from '../../learning-facts/interface.js';
import { createInMemoryFactRepository } from '../../learning-facts/ports/fact-repository.js';
import type { CandidateEvidence } from '../interface.js';
import { createProfileEvidencePipeline } from '../implementation/pipeline.js';
import { createInMemoryEvidenceRepositories } from '../ports/evidence-repository.js';

const roots: string[] = [];
const tx = {
  stageJson: async () => undefined,
  stageText: async () => undefined,
  deleteOnCommit: async () => undefined,
};
const memoryUnitOfWork = {
  async execute<T>(_request: unknown, work: (context: typeof tx) => Promise<T>) {
    return work(tx);
  },
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function fact(
  id: string,
  factType: LearningFactType,
  occurredAt: string,
  payload: Record<string, unknown> = {},
): LearningFact {
  return {
    factId: id,
    factType,
    subjectRefs: { courseId: 'course_01', lessonId: 'lesson_01' },
    occurredAt,
    recordedAt: occurredAt,
    sourceEventId: `event_${id}`,
    dataKeys:
      factType === 'LessonAbandonedFact'
        ? ['lesson.abandoned_at']
        : factType === 'LessonRestoredFact'
          ? ['lesson.restored_at']
          : ['completion.actual_seconds'],
    payload,
    schemaVersion: 1,
  };
}

async function memoryFixture(facts: readonly LearningFact[], extractorVersion = 'facts@1') {
  const factRepository = createInMemoryFactRepository();
  for (const item of facts) await factRepository.append(tx, item);
  const repositories = createInMemoryEvidenceRepositories();
  let transaction = 0;
  const pipeline = createProfileEvidencePipeline({
    factRepository,
    repositories,
    unitOfWork: memoryUnitOfWork,
    extractorVersion,
    now: () => new Date('2026-07-13T00:00:00.000Z'),
    nextTransactionId: () => `tx_pipeline_${++transaction}`,
  });
  return { factRepository, repositories, pipeline };
}

async function evidenceList(repositories: ReturnType<typeof createInMemoryEvidenceRepositories>) {
  const result: CandidateEvidence[] = [];
  for await (const item of repositories.evidence.list()) result.push(item);
  return result;
}

describe('ProfileEvidencePipeline', () => {
  it('never projects pause facts as behavior evidence and retracts a legacy pause candidate', async () => {
    const paused = fact('fact_pause', 'LessonPausedFact', '2026-07-12T09:00:00.000Z');
    const fixture = await memoryFixture([paused], 'facts@2');
    await fixture.repositories.evidence.save(
      tx,
      {
        evidenceId: 'evidence_legacy_pause',
        claimDimension: 'learning.session_regulation',
        summary: 'This learning session was explicitly paused in its recorded context.',
        sourceGroup: 'behavior',
        sourceGroupId: 'lesson:lesson_01',
        dependentSourceGroupIds: [],
        sourceFactType: 'LessonPausedFact',
        sourceRefs: ['fact:fact_pause'],
        dataKeys: ['lesson.paused_at'],
        observedAt: paused.occurredAt,
        strength: { score: 1, rationale: 'Legacy pause behavior evidence awaiting cleanup.' },
        polarity: 'supporting',
        extractorVersion: 'facts@1',
        dedupKey: 'a'.repeat(64),
        status: 'active',
        resourceVersion: 0,
      },
      0,
    );

    await fixture.pipeline.processFacts({ limit: 100 });

    expect(await evidenceList(fixture.repositories)).toEqual([
      expect.objectContaining({
        evidenceId: 'evidence_legacy_pause',
        status: 'retracted',
      }),
    ]);
  });

  it('deduplicates replay and preserves opposite abandon/restore polarities', async () => {
    const fixture = await memoryFixture([
      fact('fact_abandon', 'LessonAbandonedFact', '2026-07-12T10:00:00.000Z'),
      fact('fact_restore', 'LessonRestoredFact', '2026-07-12T11:00:00.000Z'),
    ]);
    await fixture.pipeline.processFacts({ limit: 100 });
    await fixture.pipeline.processFacts({ limit: 100 });
    expect(await evidenceList(fixture.repositories)).toEqual([
      expect.objectContaining({ polarity: 'limiting', status: 'active' }),
      expect.objectContaining({ polarity: 'supporting', status: 'active' }),
    ]);
  });

  it('retracts evidence whose source fact is explicitly superseded', async () => {
    const fixture = await memoryFixture([
      fact('fact_old', 'LessonAbandonedFact', '2026-07-12T10:00:00.000Z'),
      fact('fact_new', 'LessonRestoredFact', '2026-07-12T11:00:00.000Z', {
        supersedesFactId: 'fact_old',
      }),
    ]);
    await fixture.pipeline.processFacts({ limit: 100 });
    const evidence = await evidenceList(fixture.repositories);
    expect(evidence.find((item) => item.sourceRefs.includes('fact:fact_old'))).toMatchObject({
      status: 'retracted',
    });
    expect(evidence.find((item) => item.sourceRefs.includes('fact:fact_new'))).toMatchObject({
      status: 'active',
    });
  });

  it('records an invalid fact and does not advance its source checkpoint past it', async () => {
    const invalid = {
      ...fact('fact_invalid', 'LessonAbandonedFact', '2026-07-12T10:00:00.000Z'),
      subjectRefs: { courseId: 'course_01' },
    };
    const fixture = await memoryFixture([invalid]);
    await expect(fixture.pipeline.processFacts({ limit: 100 })).resolves.toMatchObject({
      rejected: 1,
    });
    await expect(
      fixture.repositories.checkpoints.get('checkpoint_behavior'),
    ).resolves.toBeUndefined();
    const rejected = [];
    for await (const record of fixture.repositories.rejections.list()) rejected.push(record);
    expect(rejected).toEqual([
      expect.objectContaining({
        factId: 'fact_invalid',
        sourceGroup: 'behavior',
        errorCode: 'evidence_lesson_source_missing',
      }),
    ]);
  });

  it('adds a new extractor version and supersedes the prior evidence', async () => {
    const fixture = await memoryFixture([
      fact('fact_restore', 'LessonRestoredFact', '2026-07-12T11:00:00.000Z'),
    ]);
    await fixture.pipeline.processFacts({ limit: 100 });
    const upgraded = createProfileEvidencePipeline({
      factRepository: fixture.factRepository,
      repositories: fixture.repositories,
      unitOfWork: memoryUnitOfWork,
      extractorVersion: 'facts@2',
      now: () => new Date('2026-07-13T00:00:00.000Z'),
      nextTransactionId: () => 'tx_pipeline_upgrade',
    });
    await upgraded.processFacts({ limit: 100 });
    const evidence = await evidenceList(fixture.repositories);
    expect(evidence.map((item) => [item.extractorVersion, item.status]).sort()).toEqual([
      ['facts@1', 'superseded'],
      ['facts@2', 'active'],
    ]);
  });

  it('recovers evidence and checkpoint together after a mid-commit crash', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'learning-more-pipeline-recovery-'));
    roots.push(directory);
    const dataRoot = DataRoot.create(directory);
    await initializeStoreLayout(createStorePaths(dataRoot));
    const normal = createUnitOfWork({ dataRoot });
    const facts = createLocalFileFactRepository(dataRoot);
    await normal.execute({ transactionId: 'tx_seed_fact' }, (context) =>
      facts.append(context, fact('fact_restore', 'LessonRestoredFact', '2026-07-12T11:00:00.000Z')),
    );
    let crashed = false;
    const crashing = createUnitOfWork({
      dataRoot,
      faultInjector(point) {
        if (!crashed && point === 'after-apply:0') {
          crashed = true;
          throw new Error('simulated pipeline crash');
        }
      },
    });
    const pipeline = createProfileEvidencePipeline({
      factRepository: facts,
      repositories: createLocalFileEvidenceRepositories(dataRoot),
      unitOfWork: crashing,
      extractorVersion: 'facts@1',
      now: () => new Date('2026-07-13T00:00:00.000Z'),
      nextTransactionId: () => 'tx_crashing_pipeline',
    });
    await expect(pipeline.processFacts({ limit: 100 })).rejects.toThrow('simulated pipeline crash');
    await recoverTransactions(dataRoot);
    const recovered = createLocalFileEvidenceRepositories(dataRoot);
    const evidence: CandidateEvidence[] = [];
    for await (const item of recovered.evidence.list()) evidence.push(item);
    expect(evidence).toHaveLength(1);
    await expect(recovered.checkpoints.get('checkpoint_behavior')).resolves.toMatchObject({
      lastFactId: 'fact_restore',
    });
  });

  it('is invariant to batch size and replay over 500 generated fact streams', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.constantFrom('abandon' as const, 'restore' as const, 'complete' as const), {
          maxLength: 12,
        }),
        async (kinds) => {
          const facts = kinds.map((kind, index) =>
            fact(
              `fact_${String(index).padStart(3, '0')}`,
              kind === 'abandon'
                ? 'LessonAbandonedFact'
                : kind === 'restore'
                  ? 'LessonRestoredFact'
                  : 'LessonCompletedFact',
              new Date(Date.UTC(2026, 6, 1, 0, index)).toISOString(),
              kind === 'complete' ? { actualSeconds: index * 60 } : {},
            ),
          );
          const one = await memoryFixture(facts);
          let batch;
          do {
            batch = await one.pipeline.processFacts({ limit: 1 });
          } while (batch.processed > 0);
          const all = await memoryFixture(facts);
          await all.pipeline.processFacts({ limit: 100 });
          await all.pipeline.processFacts({ limit: 100 });
          const normalize = async (fixture: typeof one) =>
            (await evidenceList(fixture.repositories)).map(({ resourceVersion, ...item }) => {
              void resourceVersion;
              return item;
            });
          expect(await normalize(one)).toEqual(await normalize(all));
        },
      ),
      { numRuns: 500 },
    );
  }, 10_000);
});
