import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { createOutlineSession, decide, evolveAll } from '../model/outline-session.js';

describe('OutlineSession', () => {
  it('moves from collecting input through assessment to candidate generation readiness', () => {
    const initial = createOutlineSession({
      outlineSessionId: 'outline_session_01',
      courseMode: 'standard',
      topic: '理解概率论',
    });

    const assessing = evolveAll(initial, decide(initial, { type: 'startAssessment' }));
    const ready = evolveAll(
      assessing,
      decide(assessing, {
        type: 'completeAssessment',
        assessmentArtifactId: 'assessment_01',
      }),
    );

    expect(assessing.state).toBe('assessing');
    expect(ready).toMatchObject({
      state: 'ready-for-candidates',
      assessmentArtifactId: 'assessment_01',
    });
  });

  it('rejects candidate generation before assessment is completed or skipped', () => {
    const initial = createOutlineSession({
      outlineSessionId: 'outline_session_01',
      courseMode: 'brainstorm',
      topic: '探索新的产品方向',
    });

    expect(() =>
      decide(initial, { type: 'requestCandidate', generationTaskId: 'task_01' }),
    ).toThrow(expect.objectContaining({ code: 'assessment_required' }));
  });

  it('rejects a second candidate task while generation is active', () => {
    const initial = createOutlineSession({
      outlineSessionId: 'outline_session_01',
      courseMode: 'standard',
      topic: '理解概率论',
    });
    const assessing = evolveAll(initial, decide(initial, { type: 'startAssessment' }));
    const ready = evolveAll(
      assessing,
      decide(assessing, { type: 'completeAssessment', assessmentArtifactId: 'assessment_01' }),
    );
    const generating = evolveAll(
      ready,
      decide(ready, { type: 'requestCandidate', generationTaskId: 'task_01' }),
    );

    expect(() =>
      decide(generating, { type: 'requestCandidate', generationTaskId: 'task_02' }),
    ).toThrow(expect.objectContaining({ code: 'generation_in_progress' }));
  });

  it('rejects confirmation of a candidate superseded by a newer version', () => {
    let session = createOutlineSession({
      outlineSessionId: 'outline_session_01',
      courseMode: 'standard',
      topic: '理解概率论',
    });
    for (const command of [
      { type: 'startAssessment' } as const,
      { type: 'completeAssessment', assessmentArtifactId: 'assessment_01' } as const,
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

  it('makes confirmation irreversible and reports confirmation_in_progress', () => {
    let session = createOutlineSession({
      outlineSessionId: 's',
      courseMode: 'standard',
      topic: '概率论',
    });
    for (const command of [
      { type: 'skipAssessment', assessmentArtifactId: 'assessment_skipped' } as const,
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

  it('never permits more than one active candidate task across 1,000 generated command sequences', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 5 }), { maxLength: 30 }), (choices) => {
        let session = createOutlineSession({
          outlineSessionId: 's',
          courseMode: 'standard',
          topic: '主题',
        });
        let started = 0;
        let finished = 0;
        for (const [index, choice] of choices.entries()) {
          const commands = [
            { type: 'startAssessment' } as const,
            { type: 'skipAssessment', assessmentArtifactId: `a_${index}` } as const,
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
            started += events.filter((event) => event.type === 'CandidateGenerationStarted').length;
            finished += events.filter((event) => event.type === 'CandidateVersionCreated').length;
            session = evolveAll(session, events);
          } catch {
            /* invalid commands must not change state */
          }
          expect(started - finished).toBe(session.state === 'generating-candidates' ? 1 : 0);
        }
      }),
      { numRuns: 1_000 },
    );
  });
});
