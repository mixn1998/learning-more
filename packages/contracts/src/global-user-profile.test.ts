import { describe, expect, it } from 'vitest';

import {
  GlobalUserProfileSnapshotSchema,
  GovernedProfileEvidenceCandidateSchema,
  ReasoningBehaviorAnalysisSnapshotSchema,
  ReasoningBehaviorEpisodeSchema,
  ReasoningDimensionDefinitionSchema,
  UserProfileEvidenceSchema,
} from './global-user-profile.js';

const hash = 'b'.repeat(64);

const evidence = {
  evidenceId: 'evidence_1',
  schemaVersion: 1,
  summary: 'The learner explicitly wants examples grounded in current work.',
  explicitness: 'user_declared',
  sourceType: 'lesson',
  sourceRefs: ['message:message_user_1'],
  sourceGroupId: 'lesson-session:session_1',
  dependentSourceGroupIds: [],
  courseContext: 'course_1',
  lessonContext: 'lesson_1',
  observedAt: '2026-07-14T00:00:00.000Z',
  sourceSnapshotHash: hash,
  qualityFlags: ['direct', 'complete'],
  safetyStatus: 'usable',
  supersedes: [],
  extractorVersion: 'profile-extractor@1',
  extractedAt: '2026-07-14T00:01:00.000Z',
  status: 'active',
} as const;

describe('global user profile contracts', () => {
  it('stores open-semantic reasoning episodes without a fixed behavior taxonomy', () => {
    const episode = ReasoningBehaviorEpisodeSchema.parse({
      episodeId: 'reasoning_episode_1',
      schemaVersion: 1,
      courseId: 'course_1',
      lessonId: 'lesson_1',
      sessionId: 'session_1',
      courseMode: 'case_study',
      behaviorSummary: 'The learner linked two mechanisms through a shared causal dependency.',
      sourceObservationRef: 'observation:observation_1',
      sourceRefs: ['message:message_user_1'],
      sourceGroupId: 'session:session_1:turn:1',
      elicitation: 'spontaneous',
      observedAt: '2026-07-14T00:00:00.000Z',
      sourceSnapshotHash: 'a'.repeat(64),
      extractorVersion: 'reasoning-episode-extractor@1',
      extractedAt: '2026-07-14T00:00:01.000Z',
      status: 'active',
      resourceVersion: 0,
    });

    expect(episode.behaviorSummary).toContain('causal');
    expect(episode).not.toHaveProperty('behaviorType');
    expect(episode).not.toHaveProperty('logicScore');
  });

  it('allows AI-induced, versioned dimensions and deterministic statistical snapshots', () => {
    const dimension = ReasoningDimensionDefinitionSchema.parse({
      dimensionId: 'dimension_causal_linking',
      dimensionSetVersion: 'dimension-set:abc',
      label: '因果关联推进',
      description: '通过可说明的因果依赖连接概念并推进当前判断。',
      inclusionSignals: ['明确说明两个对象通过何种机制相关'],
      exclusionSignals: ['只并列提到两个对象但没有关系说明'],
      derivedFromEpisodeIds: ['reasoning_episode_1'],
      analyzerVersion: 'reasoning-analyzer@1',
      createdAt: '2026-07-14T00:01:00.000Z',
      status: 'active',
    });
    const snapshot = ReasoningBehaviorAnalysisSnapshotSchema.parse({
      snapshotId: 'reasoning_snapshot_1',
      schemaVersion: 1,
      dimensionSetVersion: dimension.dimensionSetVersion,
      analyzerVersion: 'reasoning-analyzer@1',
      sourceEpisodeIds: ['reasoning_episode_1'],
      filter: {
        courseIds: ['course_1'],
        lessonIds: [],
        courseModes: ['case_study'],
        elicitations: ['spontaneous'],
      },
      eligibleEpisodeCount: 1,
      independentSourceGroupCount: 1,
      dimensions: [
        {
          dimensionId: dimension.dimensionId,
          episodeCount: 1,
          episodeShare: 1,
          independentSourceGroupCount: 1,
          spontaneousCount: 1,
          elicitedCount: 0,
          mixedCount: 0,
          unknownCount: 0,
          courseCount: 1,
          lessonCount: 1,
        },
      ],
      limitations: ['One independent source group.'],
      sourceSnapshotHash: 'b'.repeat(64),
      createdAt: '2026-07-14T00:02:00.000Z',
      status: 'provisional',
    });

    expect(snapshot.dimensions[0]?.dimensionId).toBe('dimension_causal_linking');
  });

  it('stores local source-bound evidence without fixed portrait dimensions or scores', () => {
    expect(UserProfileEvidenceSchema.parse(evidence)).toEqual(evidence);

    for (const forbidden of [
      { claimDimension: 'thinking.style' },
      { strength: { score: 3, rationale: 'frequent' } },
      { polarity: 'supporting' },
    ]) {
      expect(UserProfileEvidenceSchema.safeParse({ ...evidence, ...forbidden }).success).toBe(
        false,
      );
    }
  });

  it('keeps checkpoint-extracted evidence candidate-only while admitting new behavior labels', () => {
    const governed = GovernedProfileEvidenceCandidateSchema.parse({
      evidenceId: 'evidence_checkpoint_1',
      schemaVersion: 1,
      promotionState: 'candidate_only',
      candidateKind: 'thinking_behavior',
      claimDimension: 'thinking_tendency.counterfactual_branching',
      label: '条件变化下的反事实分支',
      summary: '在当前检查点中主动比较约束变化后的多个行动路径。',
      explicitness: 'ai_observed',
      checkpointId: 'checkpoint_1',
      checkpointIds: ['checkpoint_1'],
      checkpointKind: 'teaching_session_closed',
      sourceType: 'lesson',
      sourceRefs: ['message:message_user_1'],
      sourceGroupId: 'lesson:lesson_1:session:session_1',
      dependentSourceGroupIds: [],
      lessonContext: '决策分析',
      confidence: 0.72,
      observedCount: 1,
      firstObservedAt: '2026-07-14T00:00:00.000Z',
      lastObservedAt: '2026-07-14T00:00:00.000Z',
      sourceSnapshotHash: hash,
      sourceSnapshotHashes: [hash],
      observationKeys: ['c'.repeat(64)],
      qualityFlags: ['direct'],
      limitations: ['只代表当前教学检查点。'],
      safetyStatus: 'usable',
      contradictionEvidenceIds: [],
      expiryPolicy: { kind: 'window_bound', expiresAt: '2026-10-14T00:00:00.000Z' },
      semanticKey: 'd'.repeat(64),
      supersedes: [],
      analyzerVersion: 'profile-evidence-analyzer@1',
      extractorVersion: 'profile-evidence@1',
      extractedAt: '2026-07-14T00:00:01.000Z',
      status: 'active',
    });

    expect(governed.label).toBe('条件变化下的反事实分支');
    expect(
      GovernedProfileEvidenceCandidateSchema.safeParse({
        ...governed,
        promotionState: 'confirmed',
      }).success,
    ).toBe(false);
  });

  it('provides a deterministic consumer snapshot instead of generated portrait prose', () => {
    const snapshot = GlobalUserProfileSnapshotSchema.parse({
      profileVersion: 3,
      statisticsSnapshotRef: 'statistics:snapshot_3',
      activeEvidenceIds: ['evidence_1'],
      artifactIndexRefs: ['artifact:message_user_1'],
      evidenceCursor: 'evidence_1',
      completeness: 'limited',
      backlogCount: 0,
      sourceSnapshotHash: hash,
      createdAt: '2026-07-14T00:02:00.000Z',
    });

    expect(snapshot.activeEvidenceIds).toEqual(['evidence_1']);
    expect('portraitMarkdown' in snapshot).toBe(false);
  });
});
