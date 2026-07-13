import { describe, expect, it } from 'vitest';

import {
  classifyUserLearningMessage,
  establishesEvidenceCheckpoint,
} from '../implementation/evidence-checkpoint.js';
import { createLessonLearning, decide, evolveAll } from '../model/learning-session.js';

describe('learning evidence checkpoint', () => {
  it('[EQ-LESSON-09] accepts substantive explanation/answer/question but rejects navigation, acknowledgement, partial output, clicks, and elapsed time', () => {
    expect(
      establishesEvidenceCheckpoint({
        kind: 'assistant_explanation',
        content: '概率分布描述随机变量取值及其对应概率的完整关系。',
        complete: true,
      }),
    ).toBe(true);
    expect(classifyUserLearningMessage('为什么条件概率不等于联合概率？')).toBe(true);
    expect(classifyUserLearningMessage('好的')).toBe(false);
    for (const kind of [
      'navigation',
      'acknowledgement',
      'partial_output',
      'click',
      'elapsed_time',
    ] as const) {
      expect(establishesEvidenceCheckpoint({ kind, content: 'long but irrelevant event' })).toBe(
        false,
      );
    }
  });

  it('[EQ-LESSON-08] abandons an evidence-free lesson without a session or Review and restores it to not started', () => {
    const initial = createLessonLearning('lesson_01');
    const started = evolveAll(
      initial,
      decide(initial, { type: 'start', sessionId: 'session_01' }, 'start'),
    );
    const abandoned = evolveAll(started, decide(started, { type: 'abandon' }, 'abandon'));
    expect(abandoned.progress).toBe('abandoned');
    expect(abandoned.session).toBeUndefined();
    const restored = evolveAll(abandoned, decide(abandoned, { type: 'restore' }, 'restore'));
    expect(restored.progress).toBe('not_started');
    expect(restored.session).toBeUndefined();
  });
});
