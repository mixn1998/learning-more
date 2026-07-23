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
  it('keeps only completed lessons in the completed local-week window', () => {
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
    });

    expect(result.snapshot).toEqual([
      expect.objectContaining({
        factId: 'session',
        kind: 'learning-session',
        summary: 'LessonCompletedFact',
      }),
    ]);
    expect(result.snapshot[0]).not.toHaveProperty('payload');
    expect(result.exclusions).toEqual(['outside_window:fact:outside']);
    expect(result.projectionCursor).toBe('event_outside');
  });
});
