import { describe, expect, it } from 'vitest';

import type { GenerationExecution } from '../../generation-runtime/interface.js';
import { createGenerationNextLessonRecommender } from '../implementation/generation-next-lesson-recommender.js';

function execution(draftMarkdown: string, taskId = 'task_01'): GenerationExecution {
  return {
    submit: async () => ({ taskId }),
    awaitTerminal: async () => ({
      id: taskId,
      taskKey: 'next',
      status: 'completed',
      draftMarkdown,
      createdAt: '2026-07-14T00:00:00.000Z',
      updatedAt: '2026-07-14T00:00:00.000Z',
      resourceVersion: 1,
    }),
    stream: async () => ({
      reset: false,
      frames: [],
      meta: { taskId, state: 'completed', lastSequence: 0 },
    }),
    cancel: async () => {
      throw new Error('unexpected');
    },
    recover: async () => {
      throw new Error('unexpected');
    },
  };
}

describe('generation next lesson recommender', () => {
  it('accepts only an eligible AI choice and never starts the lesson', async () => {
    let submittedPrompt = '';
    const baseExecution = execution(
      JSON.stringify({ semanticKey: 'foundations', rationale: 'Build a shared foundation.' }),
    );
    const recommender = createGenerationNextLessonRecommender({
      providerId: 'mock',
      execution: {
        ...baseExecution,
        async submit(request) {
          submittedPrompt = request.prompt;
          return baseExecution.submit(request);
        },
      },
    });

    await expect(
      recommender.recommend({
        courseId: 'course_01',
        trigger: 'course-confirmed',
        candidates: [
          {
            semanticKey: 'foundations',
            title: 'Foundations',
            objective: 'Build foundations',
            prerequisiteSemanticKeys: [],
            estimatedMinutes: 30,
          },
          {
            semanticKey: 'advanced',
            title: 'Advanced',
            objective: 'Apply foundations',
            prerequisiteSemanticKeys: ['foundations'],
            estimatedMinutes: 45,
          },
        ],
        completedSemanticKeys: [],
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        semanticKey: 'foundations',
        rankedSemanticKeys: ['foundations'],
        rationale: 'Build a shared foundation.',
        status: 'current',
      }),
    );
    expect(submittedPrompt).toContain('【机器输出契约】');
    expect(submittedPrompt).toContain('【可选课节】');
    expect(submittedPrompt).toContain('课节标识：foundations');
    expect(submittedPrompt).toContain('Build foundations');
    expect(submittedPrompt).not.toContain('courseId');
    expect(submittedPrompt).not.toContain('trigger');
    expect(submittedPrompt).not.toContain('completedSemanticKeys');
    expect(submittedPrompt).not.toContain('previousRecommendation');
    const contractLine = submittedPrompt
      .split('\n')
      .find((line) => line.startsWith('{"semanticKey"'));
    expect(() => JSON.parse(contractLine ?? '')).not.toThrow();
  });

  it('filters ineligible ranking entries, validates evidence refs, and versions the source snapshot', async () => {
    const recommender = createGenerationNextLessonRecommender({
      providerId: 'mock',
      now: () => new Date('2026-07-14T00:00:00.000Z'),
      execution: execution(
        JSON.stringify({
          semanticKey: 'blocked',
          rankedSemanticKeys: ['blocked', 'ready'],
          rationale: 'Ready follows the completed foundation.',
          evidenceRefs: ['review:final', 'invented'],
          confidence: 0.74,
        }),
        'task_02',
      ),
    });

    await expect(
      recommender.recommend({
        courseId: 'course_01',
        trigger: 'lesson-completed',
        completedSemanticKeys: ['foundation'],
        currentFinalReviewMarkdown: 'The learner applied the foundation.',
        planSummary: 'One 30 minute slot is available.',
        candidates: [
          {
            semanticKey: 'blocked',
            title: 'Blocked',
            objective: 'Blocked',
            prerequisiteSemanticKeys: ['missing'],
            estimatedMinutes: 30,
            evidenceRefs: ['review:final'],
          },
          {
            semanticKey: 'ready',
            title: 'Ready',
            objective: 'Ready',
            prerequisiteSemanticKeys: ['foundation'],
            estimatedMinutes: 30,
            evidenceRefs: ['review:final'],
          },
        ],
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        semanticKey: 'ready',
        rankedSemanticKeys: ['ready'],
        evidenceRefs: ['review:final'],
        confidence: 0.74,
        expiresAt: '2026-07-21T00:00:00.000Z',
        status: 'current',
        warnings: ['filtered_ineligible_rank:blocked', 'filtered_unknown_evidence:invented'],
      }),
    );
  });
});
