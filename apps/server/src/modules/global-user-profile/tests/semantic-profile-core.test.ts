import { describe, expect, it } from 'vitest';

import { createInMemorySemanticProfileCoreRepository } from '../../../persistence/semantic-profile-core-repositories.js';
import { createCrossSessionSemanticCore } from '../implementation/semantic-profile-core.js';
import type { SemanticProfileCoreMerger } from '../ports/semantic-profile-core-merger.js';

const tx = {
  stageJson: async () => undefined,
  stageText: async () => undefined,
  deleteOnCommit: async () => undefined,
};
const unitOfWork = {
  execute: async <T>(_request: unknown, work: (context: typeof tx) => Promise<T>) => work(tx),
};

function source(
  id: string,
  origin: 'observed_behavior' | 'explicit_preference' = 'observed_behavior',
) {
  return {
    sourceId: `review_${id}`,
    sourceSnapshotHash: id.repeat(64).slice(0, 64),
    sourceGroupId: `session:${id}`,
    observations: [
      {
        observationId: `observation_${id}`,
        origin,
        summary:
          origin === 'observed_behavior' ? '会主动检查结论的适用条件' : '明确希望使用反例讲解',
        evidenceIds: [`evidence_${id}`],
        sourceRefs: [`review:${id}`],
      },
    ],
  } as const;
}

function merger(): SemanticProfileCoreMerger {
  return {
    version: 'semantic-merger@test',
    async merge(input) {
      return {
        assignments: input.observations.map((observation) => {
          const target = input.currentModes.find((mode) => mode.origin === observation.origin);
          return {
            sourceModeIds: target === undefined ? [] : [target.modeId],
            observationIds: [observation.observationId],
            mode: {
              origin: observation.origin,
              feature:
                observation.origin === 'observed_behavior'
                  ? '倾向核验前提、边界和反例'
                  : '偏好通过反例理解复杂概念',
              teachingImpact: '教学中使用对比和反推激活思考',
              applicabilityBoundary: '仅适用于已记录的学习情境',
              priority: 5,
            },
          };
        }),
        ignoredObservationIds: [],
      };
    },
  };
}

describe('CrossSessionSemanticCore', () => {
  it('promotes observed behavior only after two independent lesson Reviews', async () => {
    const repository = createInMemorySemanticProfileCoreRepository();
    const core = createCrossSessionSemanticCore({
      repository,
      merger: merger(),
      unitOfWork,
      now: () => new Date('2026-07-21T01:00:00.000Z'),
      nextTransactionId: () => 'tx_semantic_core',
    });

    expect((await core.ingest(source('a'))).modes).toEqual([
      expect.objectContaining({ status: 'candidate', supportingSessionCount: 1 }),
    ]);
    expect((await core.ingest(source('b'))).modes).toEqual([
      expect.objectContaining({ status: 'stable', supportingSessionCount: 2 }),
    ]);
  });

  it('keeps explicit preference distinct and stable without presenting a candidate as stable', async () => {
    const repository = createInMemorySemanticProfileCoreRepository();
    const core = createCrossSessionSemanticCore({
      repository,
      merger: merger(),
      unitOfWork,
      now: () => new Date('2026-07-21T01:00:00.000Z'),
      nextTransactionId: () => 'tx_semantic_core_origin',
    });
    await core.ingest(source('a'));
    const result = await core.ingest(source('c', 'explicit_preference'));
    expect(result.modes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ origin: 'observed_behavior', status: 'candidate' }),
        expect.objectContaining({ origin: 'explicit_preference', status: 'stable' }),
      ]),
    );
  });

  it('uses a durable receipt so retry and concurrent delivery cannot duplicate support', async () => {
    const repository = createInMemorySemanticProfileCoreRepository();
    const core = createCrossSessionSemanticCore({
      repository,
      merger: merger(),
      unitOfWork,
      now: () => new Date('2026-07-21T01:00:00.000Z'),
      nextTransactionId: () => 'tx_semantic_core_retry',
    });
    await Promise.all([core.ingest(source('a')), core.ingest(source('a'))]);
    const result = await core.getCurrent();
    expect(result?.modes).toEqual([
      expect.objectContaining({ status: 'candidate', supportingSessionCount: 1 }),
    ]);
  });

  it('serializes two different Review deliveries without losing either session', async () => {
    const repository = createInMemorySemanticProfileCoreRepository();
    const core = createCrossSessionSemanticCore({
      repository,
      merger: merger(),
      unitOfWork,
      now: () => new Date('2026-07-21T01:00:00.000Z'),
      nextTransactionId: () => 'tx_semantic_core_concurrent_reviews',
    });

    await Promise.all([core.ingest(source('a')), core.ingest(source('b'))]);

    await expect(core.getCurrent()).resolves.toMatchObject({
      modes: [
        expect.objectContaining({
          status: 'stable',
          supportingSessionCount: 2,
          representativeEvidenceIds: expect.arrayContaining(['evidence_a', 'evidence_b']),
        }),
      ],
    });
  });

  it('counts a regenerated Review from the same learning session only once', async () => {
    const repository = createInMemorySemanticProfileCoreRepository();
    const core = createCrossSessionSemanticCore({
      repository,
      merger: merger(),
      unitOfWork,
      now: () => new Date('2026-07-21T01:00:00.000Z'),
      nextTransactionId: () => 'tx_semantic_core_same_session',
    });
    const first = source('a');
    const regenerated = {
      ...source('b'),
      sourceGroupId: first.sourceGroupId,
    };

    await core.ingest(first);
    await core.ingest(regenerated);

    await expect(core.getCurrent()).resolves.toMatchObject({
      modes: [expect.objectContaining({ status: 'candidate', supportingSessionCount: 1 })],
    });
  });
});
