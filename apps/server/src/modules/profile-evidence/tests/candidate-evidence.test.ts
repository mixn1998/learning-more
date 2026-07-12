import { describe, expect, it } from 'vitest';

import {
  parseCandidateEvidence,
  supersedeCandidateEvidence,
} from '../implementation/candidate-evidence.js';
import { parseSourceCheckpoint } from '../implementation/source-checkpoint.js';

const now = new Date('2026-07-13T00:00:00.000Z');

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    evidenceId: 'evidence_01',
    claimDimension: 'learning.recovery_behavior',
    sourceGroup: 'behavior',
    sourceGroupId: 'lesson:lesson_01',
    dependentSourceGroupIds: [],
    sourceFactType: 'LessonRestoredFact',
    sourceRefs: ['fact:fact_01'],
    dataKeys: ['lesson.restored_at'],
    observedAt: '2026-07-12T23:00:00.000Z',
    strength: { score: 2, rationale: 'Explicit restore after an evidenced abandon.' },
    polarity: 'supporting',
    extractorVersion: 'behavior@1',
    dedupKey: 'a'.repeat(64),
    status: 'active',
    resourceVersion: 0,
    ...overrides,
  };
}

describe('CandidateEvidence', () => {
  it.each([
    ['unknown dataKey', { dataKeys: ['telemetry.latency_ms'] }],
    ['empty source refs', { sourceRefs: [] }],
    ['telemetry source', { sourceRefs: ['telemetry:request_01'] }],
    ['future observation', { observedAt: '2026-07-13T00:00:00.001Z' }],
    ['unexplained strength', { strength: { score: 2, rationale: '' } }],
    [
      'fact outside source group',
      { sourceGroup: 'planning', sourceFactType: 'LessonRestoredFact' },
    ],
  ])('rejects %s', (_label, overrides) => {
    expect(() => parseCandidateEvidence(candidate(overrides), now)).toThrow();
  });

  it('accepts a neutral traceable observation without turning it into a portrait claim', () => {
    expect(parseCandidateEvidence(candidate(), now)).toMatchObject({
      evidenceId: 'evidence_01',
      sourceGroup: 'behavior',
      sourceGroupId: 'lesson:lesson_01',
      status: 'active',
    });
  });

  it('supersedes instead of overwriting when the extractor version changes', () => {
    const current = parseCandidateEvidence(candidate(), now);
    const replacement = parseCandidateEvidence(
      candidate({
        evidenceId: 'evidence_02',
        extractorVersion: 'behavior@2',
        dedupKey: 'b'.repeat(64),
      }),
      now,
    );
    expect(supersedeCandidateEvidence(current, replacement)).toEqual({
      previous: { ...current, status: 'superseded' },
      replacement,
    });
    expect(() => supersedeCandidateEvidence(current, current)).toThrow('extractor_version');
  });
});

describe('SourceCheckpoint', () => {
  it('records the source cursor, extractor version, and output checksum', () => {
    expect(
      parseSourceCheckpoint({
        checkpointId: 'checkpoint_behavior',
        sourceGroup: 'behavior',
        lastFactId: 'fact_01',
        extractorVersion: 'behavior@1',
        outputChecksum: 'c'.repeat(64),
        processedFactCount: 1,
        rejectedFactCount: 0,
        updatedAt: '2026-07-13T00:00:00.000Z',
        resourceVersion: 0,
      }),
    ).toMatchObject({ lastFactId: 'fact_01', outputChecksum: 'c'.repeat(64) });
  });
});
