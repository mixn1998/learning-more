import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  ReasoningBehaviorAnalysisSnapshotSchema,
  ReasoningBehaviorClassificationSchema,
  ReasoningBehaviorEpisodeSchema,
  ReasoningDimensionDefinitionSchema,
} from '@learning-more/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import type { ReasoningBehaviorRepository } from '../modules/global-user-profile/ports/reasoning-behavior-repository.js';
import { DataRoot } from './data-root.js';
import { createStorePaths, initializeStoreLayout } from './paths.js';
import {
  createInMemoryReasoningBehaviorRepository,
  createLocalFileReasoningBehaviorRepository,
} from './reasoning-behavior-repositories.js';
import { createUnitOfWork, type UnitOfWork } from './unit-of-work.js';

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

async function localFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'learning-more-reasoning-'));
  roots.push(root);
  const dataRoot = DataRoot.create(root);
  await initializeStoreLayout(createStorePaths(dataRoot));
  return {
    repository: createLocalFileReasoningBehaviorRepository(dataRoot),
    unitOfWork: createUnitOfWork({ dataRoot }),
  };
}

async function contract(repository: ReasoningBehaviorRepository, unitOfWork: UnitOfWork) {
  const episode = ReasoningBehaviorEpisodeSchema.parse({
    episodeId: 'episode_1',
    schemaVersion: 1,
    courseId: 'course_1',
    lessonId: 'lesson_1',
    sessionId: 'session_1',
    courseMode: 'standard',
    behaviorSummary: 'The learner explained a relationship.',
    sourceObservationRef: 'observation:1',
    sourceRefs: ['message:1'],
    sourceGroupId: 'session:1:turn:1',
    elicitation: 'unknown',
    observedAt: '2026-07-14T00:00:00.000Z',
    sourceSnapshotHash: 'a'.repeat(64),
    extractorVersion: 'extractor@1',
    extractedAt: '2026-07-14T00:01:00.000Z',
    status: 'active',
    resourceVersion: 0,
  });
  await unitOfWork.execute({ transactionId: 'tx_episode' }, (context) =>
    repository.saveEpisode(context, episode, 0),
  );
  await expect(repository.getEpisode('episode_1')).resolves.toMatchObject({
    episodeId: 'episode_1',
    resourceVersion: 1,
  });

  const dimension = ReasoningDimensionDefinitionSchema.parse({
    dimensionId: 'dimension_1',
    dimensionSetVersion: 'dimension-set:1',
    label: '关系推进',
    description: 'Makes a relationship explicit.',
    inclusionSignals: [],
    exclusionSignals: [],
    derivedFromEpisodeIds: ['episode_1'],
    analyzerVersion: 'analyzer@1',
    createdAt: '2026-07-14T00:02:00.000Z',
    status: 'active',
  });
  const classification = ReasoningBehaviorClassificationSchema.parse({
    classificationId: 'classification_1',
    episodeId: 'episode_1',
    dimensionSetVersion: 'dimension-set:1',
    labels: [{ dimensionId: 'dimension_1', rationale: 'Relationship named.', confidence: 0.7 }],
    analyzerVersion: 'analyzer@1',
    sourceSnapshotHash: 'a'.repeat(64),
    classifiedAt: '2026-07-14T00:02:00.000Z',
    status: 'active',
  });
  const snapshot = ReasoningBehaviorAnalysisSnapshotSchema.parse({
    snapshotId: 'snapshot_1',
    schemaVersion: 1,
    dimensionSetVersion: 'dimension-set:1',
    analyzerVersion: 'analyzer@1',
    sourceEpisodeIds: ['episode_1'],
    filter: { courseIds: [], lessonIds: [], courseModes: [], elicitations: [] },
    eligibleEpisodeCount: 1,
    independentSourceGroupCount: 1,
    dimensions: [],
    limitations: ['Provisional.'],
    sourceSnapshotHash: 'b'.repeat(64),
    createdAt: '2026-07-14T00:02:00.000Z',
    status: 'provisional',
  });
  await unitOfWork.execute({ transactionId: 'tx_analysis' }, (context) =>
    repository.saveAnalysis(
      context,
      { snapshot, dimensions: [dimension], classifications: [classification], resourceVersion: 0 },
      0,
    ),
  );
  await expect(repository.getAnalysis('snapshot_1')).resolves.toMatchObject({
    snapshot: { snapshotId: 'snapshot_1' },
    resourceVersion: 1,
  });
}

describe('ReasoningBehavior repository contracts', () => {
  it('passes for memory', async () => {
    await contract(createInMemoryReasoningBehaviorRepository(), memoryUnitOfWork);
  });

  it('passes for local files', async () => {
    const fixture = await localFixture();
    await contract(fixture.repository, fixture.unitOfWork);
  });
});
