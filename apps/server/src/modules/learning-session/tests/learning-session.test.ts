import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  createLessonLearning,
  decide,
  evolveAll,
  LearningSessionError,
  type LessonLearning,
} from '../model/learning-session.js';
import type { LearningSessionCommand } from '../model/commands.js';

function apply(
  learning: LessonLearning,
  command: LearningSessionCommand,
  commandId: string,
): LessonLearning {
  return evolveAll(learning, decide(learning, command, commandId));
}

describe('[EQ-LESSON-01] lesson and original session lifecycle', () => {
  it('starts, pauses, and resumes the same original session', () => {
    let learning = createLessonLearning('lesson_01');
    learning = apply(learning, { type: 'start', sessionId: 'session_01' }, 'c1');
    expect(learning).toMatchObject({
      progress: 'in_progress',
      session: { id: 'session_01', state: 'active' },
    });
    learning = apply(learning, { type: 'pause' }, 'c2');
    expect(learning.session?.state).toBe('paused');
    learning = apply(learning, { type: 'resume' }, 'c3');
    expect(learning.session).toMatchObject({ id: 'session_01', state: 'active' });
  });

  it('freezes and restores the same evidenced original session', () => {
    let learning = createLessonLearning('lesson_01');
    learning = apply(learning, { type: 'start', sessionId: 'session_01' }, 'c1');
    learning = apply(learning, { type: 'appendUserMessage', messageId: 'message_01' }, 'c2');
    learning = apply(learning, { type: 'establishEvidenceCheckpoint' }, 'c3');
    learning = apply(learning, { type: 'abandon' }, 'c4');
    expect(learning).toMatchObject({
      progress: 'abandoned',
      session: { id: 'session_01', state: 'frozen', evidenceCheckpoint: true },
    });
    learning = apply(learning, { type: 'restore' }, 'c5');
    expect(learning).toMatchObject({
      progress: 'in_progress',
      session: { id: 'session_01', state: 'active' },
    });
  });

  it('marks evidence-free abandonment, deletes its session, and requires restore before a new start', () => {
    let learning = createLessonLearning('lesson_01');
    learning = apply(learning, { type: 'start', sessionId: 'empty_session' }, 'c1');
    learning = apply(learning, { type: 'abandon' }, 'c2');
    expect(learning).toMatchObject({ progress: 'abandoned' });
    expect(learning.session).toBeUndefined();
    learning = apply(learning, { type: 'restore' }, 'c3');
    expect(learning).toMatchObject({ progress: 'not_started' });
    learning = apply(learning, { type: 'start', sessionId: 'new_session' }, 'c4');
    expect(learning.session?.id).toBe('new_session');
  });

  it('keeps completed irreversible and rejects a second writable session', () => {
    let learning = createLessonLearning('lesson_01');
    learning = apply(learning, { type: 'start', sessionId: 'session_01' }, 'c1');
    expect(() => decide(learning, { type: 'start', sessionId: 'session_02' }, 'c2')).toThrow(
      expect.objectContaining({ code: 'session_conflict' }),
    );
    learning = apply(learning, { type: 'appendUserMessage', messageId: 'message_01' }, 'c3');
    learning = apply(learning, { type: 'establishEvidenceCheckpoint' }, 'c4');
    learning = apply(learning, { type: 'commitFinalReview', reviewId: 'review_01' }, 'c5');
    expect(learning).toMatchObject({
      progress: 'completed',
      session: { state: 'closed', finalReviewId: 'review_01' },
    });
    for (const command of [
      { type: 'restore' } as const,
      { type: 'resume' } as const,
      { type: 'start', sessionId: 'session_02' } as const,
    ]) {
      expect(() => decide(learning, command, 'later')).toThrow(LearningSessionError);
    }
  });

  it('completes immediately while the final Review is pending and attaches it once later', () => {
    let learning = createLessonLearning('lesson_01');
    learning = apply(learning, { type: 'start', sessionId: 'session_01' }, 'c1');
    learning = apply(learning, { type: 'appendUserMessage', messageId: 'message_01' }, 'c2');
    learning = apply(learning, { type: 'establishEvidenceCheckpoint' }, 'c3');
    learning = apply(learning, { type: 'completePendingReview' }, 'c4');
    expect(learning).toMatchObject({
      progress: 'completed',
      session: { state: 'closed' },
    });
    expect(learning.session?.finalReviewId).toBeUndefined();

    learning = apply(learning, { type: 'commitFinalReview', reviewId: 'review_01' }, 'c5');
    expect(learning.session?.finalReviewId).toBe('review_01');
    expect(() =>
      decide(learning, { type: 'commitFinalReview', reviewId: 'review_02' }, 'c6'),
    ).toThrow(expect.objectContaining({ code: 'final_review_immutable' }));
  });

  it('returns no events for an already processed command', () => {
    const initial = createLessonLearning('lesson_01');
    const started = apply(initial, { type: 'start', sessionId: 'session_01' }, 'same');
    expect(decide(started, { type: 'pause' }, 'same')).toEqual([]);
  });

  it('preserves completed irreversibility and at most one original session over 2,000 sequences', () => {
    const command = fc.oneof(
      fc.constant<LearningSessionCommand>({ type: 'start', sessionId: 'generated_session' }),
      fc.constant<LearningSessionCommand>({ type: 'pause' }),
      fc.constant<LearningSessionCommand>({ type: 'resume' }),
      fc.record({
        type: fc.constant('appendUserMessage' as const),
        messageId: fc.uuid(),
      }),
      fc.constant<LearningSessionCommand>({ type: 'establishEvidenceCheckpoint' }),
      fc.record({
        type: fc.constant('startGeneration' as const),
        taskId: fc.uuid(),
        mode: fc.constantFrom('new-turn' as const, 'retry' as const),
      }),
      fc.constant<LearningSessionCommand>({ type: 'stopGeneration' }),
      fc.constant<LearningSessionCommand>({ type: 'abandon' }),
      fc.constant<LearningSessionCommand>({ type: 'restore' }),
      fc.record({ type: fc.constant('commitFinalReview' as const), reviewId: fc.uuid() }),
    );
    fc.assert(
      fc.property(fc.array(command, { maxLength: 40 }), (commands) => {
        let learning = createLessonLearning('lesson_property');
        let completed = false;
        for (const [index, item] of commands.entries()) {
          try {
            learning = apply(learning, item, `command_${index}`);
          } catch (error) {
            expect(error).toBeInstanceOf(LearningSessionError);
          }
          if (completed) expect(learning.progress).toBe('completed');
          completed ||= learning.progress === 'completed';
          expect(learning.session === undefined ? 0 : 1).toBeLessThanOrEqual(1);
        }
      }),
      { numRuns: 2_000 },
    );
  });
});
