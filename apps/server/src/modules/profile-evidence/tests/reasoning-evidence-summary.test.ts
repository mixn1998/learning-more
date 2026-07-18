import { describe, expect, it } from 'vitest';

import { parseCandidateEvidence } from '../implementation/candidate-evidence.js';
import { reasoningEvidenceSummaryForRead } from '../implementation/reasoning-evidence-summary.js';

describe('reasoningEvidenceSummaryForRead', () => {
  it('keeps the projected session-level summary instead of concatenating raw episode prose', () => {
    const evidence = parseCandidateEvidence(
      {
        evidenceId: 'evidence_reasoning_01',
        claimDimension: 'thinking_tendency.condition_checking',
        summary: '前提核查：会先确认关键条件是否成立，再继续推导。',
        sourceGroup: 'behavior',
        sourceGroupId: 'session:session_01',
        dependentSourceGroupIds: [],
        sourceRefs: ['message:message_01', 'message:message_02'],
        dataKeys: ['user_profile.reasoning_episode.source_refs'],
        observedAt: '2026-07-17T00:00:00.000Z',
        strength: { score: 2, rationale: '来自一次学习会话中的具体表现。' },
        polarity: 'supporting',
        extractorVersion: 'reasoning-global-analyzer@2:reasoning-session-dimension@2',
        dedupKey: 'a'.repeat(64),
        status: 'active',
        resourceVersion: 0,
      },
      new Date('2026-07-17T00:00:00.000Z'),
    );
    const episodes = [
      {
        episodeId: 'episode_01',
        schemaVersion: 1 as const,
        courseId: 'course_01',
        lessonId: 'lesson_01',
        sessionId: 'session_01',
        courseMode: 'standard' as const,
        behaviorSummary: '一整段很长的原始行为观察，不应与其他观察直接拼接。',
        sourceObservationRef: 'observation:01',
        sourceRefs: ['message:message_01'],
        sourceGroupId: 'session:01:turn:01',
        elicitation: 'spontaneous' as const,
        observedAt: '2026-07-17T00:00:00.000Z',
        sourceSnapshotHash: 'b'.repeat(64),
        extractorVersion: 'episode@1',
        extractedAt: '2026-07-17T00:00:01.000Z',
        status: 'active' as const,
        resourceVersion: 1,
      },
      {
        episodeId: 'episode_02',
        schemaVersion: 1 as const,
        courseId: 'course_01',
        lessonId: 'lesson_01',
        sessionId: 'session_01',
        courseMode: 'standard' as const,
        behaviorSummary: '第二段很长的原始行为观察，也不应被串到用户可见摘要中。',
        sourceObservationRef: 'observation:02',
        sourceRefs: ['message:message_02'],
        sourceGroupId: 'session:01:turn:02',
        elicitation: 'spontaneous' as const,
        observedAt: '2026-07-17T00:01:00.000Z',
        sourceSnapshotHash: 'c'.repeat(64),
        extractorVersion: 'episode@1',
        extractedAt: '2026-07-17T00:01:01.000Z',
        status: 'active' as const,
        resourceVersion: 1,
      },
    ];

    expect(reasoningEvidenceSummaryForRead(evidence, episodes)).toBe(evidence.summary);
  });
});
