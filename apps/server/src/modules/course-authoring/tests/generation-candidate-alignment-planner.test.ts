import { describe, expect, it } from 'vitest';

import { createGenerationCandidateAlignmentPlanner } from '../implementation/generation-candidate-alignment-planner.js';

describe('generation candidate alignment planner', () => {
  it('returns an operational action without constraining the teaching content', async () => {
    const planner = createGenerationCandidateAlignmentPlanner({
      providerId: 'mock',
      execution: {
        submit: async () => ({ taskId: 'task_alignment_01' }),
        awaitTerminal: async () => ({
          id: 'task_alignment_01',
          taskKey: 'alignment',
          status: 'completed',
          draftMarkdown:
            '{"action":"patch","rationale":"Only the decision module changes.","targetModuleIds":["lesson_decision"]}',
          createdAt: '2026-07-14T00:00:00.000Z',
          updatedAt: '2026-07-14T00:00:00.000Z',
          resourceVersion: 1,
        }),
        stream: async () => ({
          reset: false,
          frames: [],
          meta: { taskId: 'task_alignment_01', state: 'completed', lastSequence: 0 },
        }),
        cancel: async () => {
          throw new Error('unexpected');
        },
        recover: async () => {
          throw new Error('unexpected');
        },
      },
    });

    await expect(
      planner.plan({
        outlineSessionId: 'session_01',
        phase: 'candidate-alignment',
        topic: 'Decision making',
        courseMode: 'case_study',
        completedAssessmentRounds: 3,
        messages: [],
        materials: [],
        candidate: { candidateVersionId: 'candidate_01', markdown: '# Candidate' },
      }),
    ).resolves.toEqual({
      action: 'patch',
      rationale: 'Only the decision module changes.',
      targetModuleIds: ['lesson_decision'],
    });
  });
});
