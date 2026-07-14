import { describe, expect, it } from 'vitest';

import type { LearningFact, LearningFactType } from '../interface.js';
import { assembleWeeklyEvidence } from '../implementation/weekly-evidence-assembler.js';

function fact(factId: string, factType: LearningFactType, occurredAt: string): LearningFact {
  return {
    factId,
    factType,
    subjectRefs: { courseId: 'course_01', lessonId: 'lesson_01' },
    occurredAt,
    recordedAt: occurredAt,
    sourceEventId: `event_${factId}`,
    dataKeys: [],
    payload: {},
    schemaVersion: 1,
  };
}

describe('assembleWeeklyEvidence', () => {
  it('freezes timezone-bounded sessions, ledger events, Reviews, plan changes, and reasoning evidence', () => {
    const result = assembleWeeklyEvidence({
      timeZone: 'Asia/Shanghai',
      startLocalDate: '2026-07-06',
      endLocalDate: '2026-07-13',
      facts: [
        fact('session', 'LessonCompletedFact', '2026-07-06T01:00:00.000Z'),
        fact('ledger', 'InteractionRespondedFact', '2026-07-07T01:00:00.000Z'),
        fact('review', 'ReviewFinalizedFact', '2026-07-08T01:00:00.000Z'),
        fact('plan', 'ScheduleConfirmedFact', '2026-07-09T01:00:00.000Z'),
        fact('outside', 'LessonCompletedFact', '2026-07-13T01:00:00.000Z'),
      ],
      additionalEvidence: [
        {
          factId: 'reasoning:episode_01',
          sourceRef: 'reasoning:episode_01',
          kind: 'reasoning-evidence',
          occurredAt: '2026-07-10T01:00:00.000Z',
          summary: 'Compared two explanations before revising a claim.',
          payload: { status: 'active' },
          actualSeconds: 0,
          topicTags: [],
        },
      ],
    });

    expect(result.snapshot.map((entry) => entry.kind)).toEqual([
      'learning-session',
      'teaching-ledger',
      'review',
      'plan-change',
      'reasoning-evidence',
    ]);
    expect(result.exclusions).toEqual(['outside_window:fact:outside']);
  });
});
