import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  createOutlineSession,
  decide,
  evolveAll,
  type OutlineSession,
} from '../model/outline-session.js';

function started(): OutlineSession {
  const initial = createOutlineSession({
    outlineSessionId: 'outline_session_01',
    courseMode: 'standard',
    topic: '理解概率论',
  });
  return evolveAll(initial, decide(initial, { type: 'startAssessment' }));
}

function completeTurn(session: OutlineSession, index: number): OutlineSession {
  const userMessageId = `user_${index}`;
  const running = evolveAll(
    session,
    decide(session, { type: 'startAssessmentTurn', userMessageId }),
  );
  return evolveAll(
    running,
    decide(running, {
      type: 'completeAssessmentTurn',
      userMessageId,
      assistantMessageId: `assistant_${index}`,
    }),
  );
}

describe('OutlineSession', () => {
  it('counts only complete user and assistant pairs and opens generation after round three', () => {
    let session = started();
    expect(session).toMatchObject({ state: 'assessing', completedAssessmentRounds: 0 });

    session = completeTurn(session, 1);
    expect(session).toMatchObject({ state: 'assessing', completedAssessmentRounds: 1 });
    session = completeTurn(session, 2);
    expect(session).toMatchObject({ state: 'assessing', completedAssessmentRounds: 2 });
    session = completeTurn(session, 3);
    expect(session).toMatchObject({ state: 'assessment-ready', completedAssessmentRounds: 3 });
    expect(session.messageIds).toEqual([
      'user_1',
      'assistant_1',
      'user_2',
      'assistant_2',
      'user_3',
      'assistant_3',
    ]);
  });

  it('does not count a failed assistant turn', () => {
    const session = started();
    const running = evolveAll(
      session,
      decide(session, { type: 'startAssessmentTurn', userMessageId: 'user_1' }),
    );
    const failed = evolveAll(
      running,
      decide(running, { type: 'failAssessmentTurn', userMessageId: 'user_1' }),
    );

    expect(failed).toMatchObject({ state: 'assessing', completedAssessmentRounds: 0 });
    expect(failed.messageIds).toEqual(['user_1']);
  });

  it('rejects candidate generation before three complete rounds', () => {
    let session = completeTurn(completeTurn(started(), 1), 2);
    expect(() =>
      decide(session, { type: 'requestCandidate', generationTaskId: 'task_01' }),
    ).toThrow(expect.objectContaining({ code: 'assessment_required' }));

    session = completeTurn(session, 3);
    expect(decide(session, { type: 'requestCandidate', generationTaskId: 'task_01' })).toEqual([
      { type: 'CandidateGenerationStarted', generationTaskId: 'task_01' },
    ]);
  });

  it('keeps generation available when the user voluntarily completes more rounds', () => {
    let session = completeTurn(completeTurn(completeTurn(started(), 1), 2), 3);
    session = completeTurn(session, 4);

    expect(session).toMatchObject({ state: 'assessment-ready', completedAssessmentRounds: 4 });
    expect(decide(session, { type: 'requestCandidate', generationTaskId: 'task_01' })).toHaveLength(
      1,
    );
  });

  it('rejects a second candidate task while generation is active', () => {
    const ready = completeTurn(completeTurn(completeTurn(started(), 1), 2), 3);
    const generating = evolveAll(
      ready,
      decide(ready, { type: 'requestCandidate', generationTaskId: 'task_01' }),
    );

    expect(() =>
      decide(generating, { type: 'requestCandidate', generationTaskId: 'task_02' }),
    ).toThrow(expect.objectContaining({ code: 'generation_in_progress' }));
  });

  it('rejects confirmation of a candidate superseded by a newer version', () => {
    let session = completeTurn(completeTurn(completeTurn(started(), 1), 2), 3);
    for (const command of [
      { type: 'requestCandidate', generationTaskId: 'task_01' } as const,
      {
        type: 'candidateGenerated',
        generationTaskId: 'task_01',
        candidateVersionId: 'candidate_v1',
      } as const,
      { type: 'requestCandidate', generationTaskId: 'task_02' } as const,
      {
        type: 'candidateGenerated',
        generationTaskId: 'task_02',
        candidateVersionId: 'candidate_v2',
      } as const,
    ]) {
      session = evolveAll(session, decide(session, command));
    }

    expect(() =>
      decide(session, { type: 'confirmCandidate', candidateVersionId: 'candidate_v1' }),
    ).toThrow(expect.objectContaining({ code: 'candidate_stale' }));
  });

  it('keeps post-candidate dialogue open and records whether the next candidate is patched or regenerated', () => {
    let session = completeTurn(completeTurn(completeTurn(started(), 1), 2), 3);
    for (const command of [
      { type: 'requestCandidate', generationTaskId: 'task_01' } as const,
      {
        type: 'candidateGenerated',
        generationTaskId: 'task_01',
        candidateVersionId: 'candidate_v1',
      } as const,
      { type: 'startAlignmentTurn', userMessageId: 'alignment_user_01' } as const,
      {
        type: 'completeAlignmentTurn',
        userMessageId: 'alignment_user_01',
        assistantMessageId: 'alignment_assistant_01',
        action: 'patch',
        targetModuleIds: ['lesson_02'],
      } as const,
    ]) {
      session = evolveAll(session, decide(session, command));
    }

    expect(session).toMatchObject({
      state: 'candidate-ready',
      latestCandidateVersionId: 'candidate_v1',
      pendingAlignment: { action: 'patch', targetModuleIds: ['lesson_02'] },
      completedAssessmentRounds: 3,
    });
    expect(decide(session, { type: 'requestCandidate', generationTaskId: 'task_02' })).toEqual([
      { type: 'CandidateGenerationStarted', generationTaskId: 'task_02' },
    ]);
  });

  it('makes confirmation irreversible', () => {
    let session = completeTurn(completeTurn(completeTurn(started(), 1), 2), 3);
    for (const command of [
      { type: 'requestCandidate', generationTaskId: 'task_1' } as const,
      { type: 'candidateGenerated', generationTaskId: 'task_1', candidateVersionId: 'v1' } as const,
      { type: 'confirmCandidate', candidateVersionId: 'v1' } as const,
      { type: 'completeConfirmation', courseId: 'course_1' } as const,
    ])
      session = evolveAll(session, decide(session, command));

    expect(session).toMatchObject({ state: 'confirmed', confirmedCourseId: 'course_1' });
    expect(() => decide(session, { type: 'requestCandidate', generationTaskId: 'late' })).toThrow(
      expect.objectContaining({ code: 'confirmation_in_progress' }),
    );
  });

  it('never permits more than one active candidate task across generated command sequences', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 3 }), { maxLength: 30 }), (choices) => {
        let session = completeTurn(completeTurn(completeTurn(started(), 1), 2), 3);
        let startedTasks = 0;
        let finishedTasks = 0;
        for (const [index, choice] of choices.entries()) {
          const commands = [
            { type: 'requestCandidate', generationTaskId: `t_${index}` } as const,
            {
              type: 'candidateGenerated',
              generationTaskId: session.activeCandidateTaskId ?? 'stale',
              candidateVersionId: `v_${index}`,
            } as const,
            {
              type: 'confirmCandidate',
              candidateVersionId: session.latestCandidateVersionId ?? 'stale',
            } as const,
            { type: 'completeConfirmation', courseId: `c_${index}` } as const,
          ];
          try {
            const events = decide(session, commands[choice]!);
            startedTasks += events.filter(
              (event) => event.type === 'CandidateGenerationStarted',
            ).length;
            finishedTasks += events.filter(
              (event) => event.type === 'CandidateVersionCreated',
            ).length;
            session = evolveAll(session, events);
          } catch {
            // Invalid commands must leave the aggregate unchanged.
          }
          expect(startedTasks - finishedTasks).toBe(
            session.state === 'generating-candidates' ? 1 : 0,
          );
        }
      }),
      { numRuns: 1_000 },
    );
  });
});
