import type { TeachingObservation } from '@learning-more/contracts';
import { describe, expect, it } from 'vitest';

import { createInMemoryReasoningBehaviorRepository } from '../../../persistence/reasoning-behavior-repositories.js';
import { createReasoningBehaviorModule } from '../implementation/reasoning-behavior-module.js';

const tx = {
  stageJson: async () => undefined,
  stageText: async () => undefined,
  deleteOnCommit: async () => undefined,
};
const unitOfWork = {
  async execute<T>(_request: unknown, work: (context: typeof tx) => Promise<T>) {
    return work(tx);
  },
};

function observation(input: {
  id: string;
  sessionId: string;
  turn: number;
  entryId: string;
  summary: string;
  elicitation: 'spontaneous' | 'elicited';
}): TeachingObservation {
  return {
    observationId: input.id,
    schemaVersion: 1,
    lessonId: 'lesson_1',
    sessionId: input.sessionId,
    turnSequence: input.turn,
    sourceMessageIds: [`message_${input.entryId}`],
    sourceSnapshotHash: (input.turn % 2 === 0 ? 'b' : 'a').repeat(64),
    scope: {
      alignment: 'direct',
      relationRefs: ['knowledge:kp_1'],
      rationale: 'Direct learning behavior.',
    },
    entries: [
      {
        entryId: input.entryId,
        kind: 'learner_reasoning_behavior',
        summary: input.summary,
        knowledgePointRefs: ['knowledge:kp_1'],
        sourceRefs: [`message:message_${input.entryId}`],
        explicitness: 'ai_observed',
        elicitation: input.elicitation,
        resolvesEntryRefs: [],
        qualityFlags: ['direct', 'complete'],
      },
    ],
    observerVersion: 'teaching-observer@1',
    observedAt: '2026-07-14T00:00:00.000Z',
    status: 'active',
  };
}

describe('ReasoningBehaviorModule', () => {
  it('captures open-semantic episodes idempotently and builds dynamic multi-label statistics', async () => {
    const repository = createInMemoryReasoningBehaviorRepository();
    const module = createReasoningBehaviorModule({
      repository,
      unitOfWork,
      analyzer: {
        version: 'reasoning-analyzer@1',
        async analyze(input) {
          return {
            dimensions: [
              {
                label: '机制关联推进',
                description: '通过共同机制连接对象并推进判断。',
                inclusionSignals: ['说明关系机制'],
                exclusionSignals: ['只做并列罗列'],
                derivedFromEpisodeIds: input.episodes.map((episode) => episode.episodeId),
              },
              {
                label: '表征重构',
                description: '改变问题表征以发现新的解释路径。',
                inclusionSignals: ['主动改写问题的观察单位'],
                exclusionSignals: ['只重复原问题'],
                derivedFromEpisodeIds: [input.episodes[0]!.episodeId],
              },
            ],
            classifications: input.episodes.map((episode, index) => ({
              episodeId: episode.episodeId,
              labels: [
                {
                  label: '机制关联推进',
                  rationale: 'The learner made the connecting mechanism explicit.',
                  confidence: 0.82,
                },
                {
                  label: '机制关联推进',
                  rationale: 'Duplicate lower-confidence label must be collapsed.',
                  confidence: 0.4,
                },
                ...(index === 0
                  ? [
                      {
                        label: '表征重构',
                        rationale: 'The learner changed the unit of analysis.',
                        confidence: 0.74,
                      },
                    ]
                  : []),
              ],
            })),
          };
        },
      },
      now: () => new Date('2026-07-14T00:03:00.000Z'),
      nextTransactionId: () => 'tx_reasoning',
    });
    const first = observation({
      id: 'observation_1',
      sessionId: 'session_1',
      turn: 1,
      entryId: 'reasoning_1',
      summary: 'The learner linked an index change to the underlying lookup mechanism.',
      elicitation: 'spontaneous',
    });
    const second = observation({
      id: 'observation_2',
      sessionId: 'session_2',
      turn: 1,
      entryId: 'reasoning_2',
      summary:
        'The learner connected feedback timing to the next decision through state information.',
      elicitation: 'elicited',
    });

    await module.captureFromObservation({
      courseId: 'course_1',
      courseMode: 'case_study',
      observation: first,
    });
    await module.captureFromObservation({
      courseId: 'course_1',
      courseMode: 'case_study',
      observation: first,
    });
    await module.captureFromObservation({
      courseId: 'course_1',
      courseMode: 'case_study',
      observation: second,
    });

    const episodes = [];
    for await (const episode of repository.listEpisodes()) episodes.push(episode);
    expect(episodes).toHaveLength(2);
    expect(episodes[0]).not.toHaveProperty('behaviorType');

    const analysis = await module.refreshAnalysis({
      courseIds: ['course_1'],
      courseModes: ['case_study'],
      elicitations: [],
    });

    expect(analysis?.dimensions.map((dimension) => dimension.label)).toEqual([
      '机制关联推进',
      '表征重构',
    ]);
    expect(analysis?.classifications[0]?.labels).toHaveLength(2);
    expect(
      analysis?.classifications[0]?.labels.find(
        (label) =>
          analysis.dimensions.find((dimension) => dimension.dimensionId === label.dimensionId)
            ?.label === '机制关联推进',
      )?.confidence,
    ).toBe(0.82);
    expect(analysis?.snapshot).toMatchObject({
      eligibleEpisodeCount: 2,
      independentSourceGroupCount: 2,
      status: 'usable',
      dimensions: [
        expect.objectContaining({
          episodeCount: 2,
          independentSourceGroupCount: 2,
          spontaneousCount: 1,
          elicitedCount: 1,
        }),
        expect.objectContaining({ episodeCount: 1 }),
      ],
    });
  });

  it('filters by window and context before asking AI to induce dimensions', async () => {
    const repository = createInMemoryReasoningBehaviorRepository();
    let analyzedEpisodeCount = 0;
    const module = createReasoningBehaviorModule({
      repository,
      unitOfWork,
      analyzer: {
        version: 'reasoning-analyzer@2',
        async analyze(input) {
          analyzedEpisodeCount = input.episodes.length;
          return { dimensions: [], classifications: [] };
        },
      },
      now: () => new Date('2026-07-14T00:03:00.000Z'),
      nextTransactionId: () => 'tx_reasoning_filter',
    });
    await module.captureFromObservation({
      courseId: 'course_1',
      courseMode: 'standard',
      observation: observation({
        id: 'observation_filter',
        sessionId: 'session_filter',
        turn: 1,
        entryId: 'reasoning_filter',
        summary: 'The learner reformulated the relationship.',
        elicitation: 'spontaneous',
      }),
    });

    await module.refreshAnalysis({
      courseModes: ['case_study'],
      courseIds: [],
      elicitations: [],
    });
    expect(analyzedEpisodeCount).toBe(0);
  });

  it('carries prior open-ended dimensions forward and keeps their identity stable across refreshes', async () => {
    const repository = createInMemoryReasoningBehaviorRepository();
    const priorDimensionLabels: string[][] = [];
    const module = createReasoningBehaviorModule({
      repository,
      unitOfWork,
      analyzer: {
        version: 'reasoning-analyzer@continuity',
        async analyze(input) {
          priorDimensionLabels.push(input.priorDimensions.map((dimension) => dimension.label));
          return {
            dimensions: [
              {
                label: '关系机制推演',
                description: '围绕关系机制推进判断。',
                inclusionSignals: ['说明关系机制'],
                exclusionSignals: ['仅做并列罗列'],
                derivedFromEpisodeIds: input.episodes.map((episode) => episode.episodeId),
              },
            ],
            classifications: input.episodes.map((episode) => ({
              episodeId: episode.episodeId,
              labels: [
                { label: '关系机制推演', rationale: '存在可回溯的机制推理。', confidence: 0.8 },
              ],
            })),
          };
        },
      },
      now: () => new Date('2026-07-14T00:03:00.000Z'),
      nextTransactionId: () => 'tx_reasoning_continuity',
    });
    await module.captureFromObservation({
      courseId: 'course_1',
      courseMode: 'standard',
      observation: observation({
        id: 'observation_continuity_1',
        sessionId: 'session_continuity_1',
        turn: 1,
        entryId: 'reasoning_continuity_1',
        summary: '用户说明了两个概念之间的作用机制。',
        elicitation: 'spontaneous',
      }),
    });
    const first = await module.refreshAnalysis();
    await module.captureFromObservation({
      courseId: 'course_1',
      courseMode: 'standard',
      observation: observation({
        id: 'observation_continuity_2',
        sessionId: 'session_continuity_2',
        turn: 2,
        entryId: 'reasoning_continuity_2',
        summary: '用户用同一机制解释新的案例。',
        elicitation: 'spontaneous',
      }),
    });
    const second = await module.refreshAnalysis();

    expect(priorDimensionLabels).toEqual([[], ['关系机制推演']]);
    expect(second?.dimensions[0]?.dimensionId).toBe(first?.dimensions[0]?.dimensionId);
  });

  it('captures a confirmed authoring conversation only after it has become a course', async () => {
    const repository = createInMemoryReasoningBehaviorRepository();
    const module = createReasoningBehaviorModule({
      repository,
      unitOfWork,
      analyzer: {
        version: 'reasoning-analyzer@authoring',
        async analyze() {
          return { dimensions: [], classifications: [] };
        },
      },
      now: () => new Date('2026-07-14T00:03:00.000Z'),
      nextTransactionId: () => 'tx_reasoning_authoring',
    });

    await expect(
      module.captureFromConfirmedAuthoring({
        courseId: 'course_created_1',
        courseMode: 'argument_clash',
        checkpointId: 'profile:session_1:candidate-confirmed',
        sourceGroupId: 'outline:session_1',
        sourceSnapshotHash: 'a'.repeat(64),
        extractedAt: '2026-07-14T00:03:00.000Z',
        sources: [
          { sourceRef: 'message:user_1', role: 'user', observedAt: '2026-07-14T00:00:00.000Z' },
          {
            sourceRef: 'message:assistant_1',
            role: 'assistant',
            observedAt: '2026-07-14T00:01:00.000Z',
          },
        ],
        candidates: [
          {
            candidateKind: 'thinking_behavior',
            summary: '用户比较了两个论点的前提。',
            sourceRefs: ['message:user_1'],
            safetyStatus: 'usable',
          },
          {
            candidateKind: 'thinking_behavior',
            summary: '不安全的推断不应进入统计。',
            sourceRefs: ['message:user_1'],
            safetyStatus: 'blocked',
          },
        ],
      }),
    ).resolves.toMatchObject({ createdEpisodeIds: [expect.any(String)] });

    const episodes = [];
    for await (const episode of repository.listEpisodes()) episodes.push(episode);
    expect(episodes).toEqual([
      expect.objectContaining({
        courseId: 'course_created_1',
        lessonId: 'authoring',
        courseMode: 'argument_clash',
        elicitation: 'spontaneous',
      }),
    ]);
  });
});
