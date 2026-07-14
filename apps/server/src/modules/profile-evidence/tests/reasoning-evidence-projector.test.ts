import { describe, expect, it } from 'vitest';

import { createReasoningEvidenceProjector } from '../implementation/reasoning-evidence-projector.js';
import { createInMemoryEvidenceRepositories } from '../ports/evidence-repository.js';

describe('reasoning evidence projector', () => {
  it('persists an open-ended AI-derived tendency without promoting it to a permanent fact', async () => {
    const evidenceRepositories = createInMemoryEvidenceRepositories();
    const episode = {
      episodeId: 'episode_01',
      schemaVersion: 1 as const,
      courseId: 'course_01',
      lessonId: 'lesson_01',
      sessionId: 'session_01',
      courseMode: 'standard' as const,
      behaviorSummary: 'Learner connected two models.',
      sourceObservationRef: 'observation:01',
      sourceRefs: ['message:message_01'],
      sourceGroupId: 'session:01:turn:01',
      elicitation: 'spontaneous' as const,
      observedAt: '2026-07-13T00:00:00.000Z',
      sourceSnapshotHash: 'a'.repeat(64),
      extractorVersion: 'episode@1',
      extractedAt: '2026-07-13T00:00:01.000Z',
      status: 'active' as const,
      resourceVersion: 1,
    };
    const projector = createReasoningEvidenceProjector({
      reasoningRepository: {
        getEpisode: async () => episode,
      },
      evidenceRepositories,
      unitOfWork: {
        execute: async (_request, work) =>
          work({
            stageJson: async () => undefined,
            stageText: async () => undefined,
            deleteOnCommit: async () => undefined,
          }),
      },
      now: () => new Date('2026-07-14T00:00:00.000Z'),
      nextTransactionId: () => 'tx_01',
    });

    await expect(
      projector.project({
        snapshot: {
          snapshotId: 'snapshot_01',
          schemaVersion: 1,
          dimensionSetVersion: 'set_01',
          analyzerVersion: 'analyzer@1',
          sourceEpisodeIds: ['episode_01'],
          filter: { courseIds: [], lessonIds: [], courseModes: [], elicitations: [] },
          eligibleEpisodeCount: 1,
          independentSourceGroupCount: 1,
          dimensions: [],
          limitations: [],
          sourceSnapshotHash: 'b'.repeat(64),
          createdAt: '2026-07-14T00:00:00.000Z',
          status: 'provisional',
        },
        dimensions: [
          {
            dimensionId: 'dimension_association',
            dimensionSetVersion: 'set_01',
            label: '关联思考',
            description: 'Connects models.',
            inclusionSignals: [],
            exclusionSignals: [],
            derivedFromEpisodeIds: ['episode_01'],
            analyzerVersion: 'analyzer@1',
            createdAt: '2026-07-14T00:00:00.000Z',
            status: 'active',
          },
        ],
        classifications: [
          {
            classificationId: 'classification_01',
            episodeId: 'episode_01',
            dimensionSetVersion: 'set_01',
            labels: [
              {
                dimensionId: 'dimension_association',
                rationale: '跨模型建立了关系。',
                confidence: 0.7,
              },
            ],
            analyzerVersion: 'analyzer@1',
            sourceSnapshotHash: 'a'.repeat(64),
            classifiedAt: '2026-07-14T00:00:00.000Z',
            status: 'active',
          },
        ],
        resourceVersion: 1,
      }),
    ).resolves.toEqual({ created: 1 });

    const stored = [];
    for await (const evidence of evidenceRepositories.evidence.list()) stored.push(evidence);
    expect(stored).toEqual([
      expect.objectContaining({
        claimDimension: 'thinking_tendency.dimension_association',
        status: 'active',
      }),
    ]);

    await expect(
      projector.project({
        snapshot: {
          snapshotId: 'snapshot_02',
          schemaVersion: 1,
          dimensionSetVersion: 'set_02',
          analyzerVersion: 'analyzer@1',
          sourceEpisodeIds: ['episode_01'],
          filter: { courseIds: [], lessonIds: [], courseModes: [], elicitations: [] },
          eligibleEpisodeCount: 1,
          independentSourceGroupCount: 1,
          dimensions: [],
          limitations: [],
          sourceSnapshotHash: 'c'.repeat(64),
          createdAt: '2026-07-14T00:01:00.000Z',
          status: 'provisional',
        },
        dimensions: [
          {
            dimensionId: 'dimension_association_revised',
            dimensionSetVersion: 'set_02',
            continuesDimensionId: 'dimension_association',
            label: '关联思考',
            description: 'Revised wording for the same evidence-grounded tendency.',
            inclusionSignals: [],
            exclusionSignals: [],
            derivedFromEpisodeIds: ['episode_01'],
            analyzerVersion: 'analyzer@1',
            createdAt: '2026-07-14T00:01:00.000Z',
            status: 'active',
          },
        ],
        classifications: [
          {
            classificationId: 'classification_02',
            episodeId: 'episode_01',
            dimensionSetVersion: 'set_02',
            labels: [
              {
                dimensionId: 'dimension_association_revised',
                rationale: '同一条行为证据被用新一版维度定义重新解释。',
                confidence: 0.8,
              },
            ],
            analyzerVersion: 'analyzer@1',
            sourceSnapshotHash: 'a'.repeat(64),
            classifiedAt: '2026-07-14T00:01:00.000Z',
            status: 'active',
          },
        ],
        resourceVersion: 1,
      }),
    ).resolves.toEqual({ created: 0 });
  });
});
