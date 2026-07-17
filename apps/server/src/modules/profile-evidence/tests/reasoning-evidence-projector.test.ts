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

  it('projects one abstract candidate per learning session and global dimension', async () => {
    const evidenceRepositories = createInMemoryEvidenceRepositories();
    const episodes = new Map(
      [
        ['episode_1', 'session_1', 'message_1', '2026-07-13T00:00:00.000Z'],
        ['episode_2', 'session_1', 'message_2', '2026-07-13T00:01:00.000Z'],
        ['episode_3', 'session_2', 'message_3', '2026-07-13T00:02:00.000Z'],
      ].map(([episodeId, sessionId, messageId, observedAt]) => [
        episodeId!,
        {
          episodeId: episodeId!,
          schemaVersion: 1 as const,
          courseId: 'course_01',
          lessonId: `lesson_${sessionId!.at(-1)}`,
          sessionId: sessionId!,
          courseMode: 'standard' as const,
          behaviorSummary: 'A Review-produced session dimension.',
          sourceObservationRef: `review:${sessionId}`,
          sourceRefs: [`message:${messageId}`],
          sourceGroupId: `legacy:${episodeId}`,
          elicitation: 'unknown' as const,
          observedAt: observedAt!,
          sourceSnapshotHash: episodeId!.at(-1)!.repeat(64),
          extractorVersion: 'review-session-dimension@1',
          extractedAt: '2026-07-13T00:03:00.000Z',
          status: 'active' as const,
          resourceVersion: 1,
        },
      ]),
    );
    const projector = createReasoningEvidenceProjector({
      reasoningRepository: { getEpisode: async (episodeId) => episodes.get(episodeId) },
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
      nextTransactionId: () => 'tx_session_projection',
    });

    await expect(
      projector.project({
        snapshot: {
          snapshotId: 'snapshot_sessions',
          schemaVersion: 1,
          dimensionSetVersion: 'set_sessions',
          analyzerVersion: 'reasoning-global-analyzer@2',
          sourceEpisodeIds: [...episodes.keys()],
          filter: { courseIds: [], lessonIds: [], courseModes: [], elicitations: [] },
          eligibleEpisodeCount: 3,
          independentSourceGroupCount: 2,
          dimensions: [],
          limitations: [],
          sourceSnapshotHash: 'f'.repeat(64),
          createdAt: '2026-07-14T00:00:00.000Z',
          status: 'usable',
        },
        dimensions: [
          {
            dimensionId: 'dimension_condition_checking',
            dimensionSetVersion: 'set_sessions',
            label: '前提核查',
            description: '在形成判断前主动确认约束、规则和信息完整性。',
            inclusionSignals: [],
            exclusionSignals: [],
            derivedFromEpisodeIds: [...episodes.keys()],
            analyzerVersion: 'reasoning-global-analyzer@2',
            createdAt: '2026-07-14T00:00:00.000Z',
            status: 'active',
          },
        ],
        classifications: [...episodes.keys()].map((episodeId, index) => ({
          classificationId: `classification_${index}`,
          episodeId,
          dimensionSetVersion: 'set_sessions',
          labels: [
            {
              dimensionId: 'dimension_condition_checking',
              rationale: `Concrete rationale ${index} must not enter the global candidate.`,
              confidence: 0.9,
            },
          ],
          analyzerVersion: 'reasoning-global-analyzer@2',
          sourceSnapshotHash: 'e'.repeat(64),
          classifiedAt: '2026-07-14T00:00:00.000Z',
          status: 'active' as const,
        })),
        resourceVersion: 1,
      }),
    ).resolves.toEqual({ created: 2 });

    const stored = [];
    for await (const evidence of evidenceRepositories.evidence.list()) stored.push(evidence);
    expect(stored).toHaveLength(2);
    expect(stored.find((evidence) => evidence.sourceGroupId === 'session:session_1')).toMatchObject(
      {
        summary: '前提核查：在形成判断前主动确认约束、规则和信息完整性。',
        sourceRefs: ['message:message_1', 'message:message_2'],
      },
    );
    expect(stored.every((evidence) => !evidence.summary.includes('Concrete rationale'))).toBe(true);
  });
});
