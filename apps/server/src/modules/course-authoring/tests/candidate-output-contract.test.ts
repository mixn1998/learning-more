import { describe, expect, it } from 'vitest';

import {
  CandidateModelResponseSchema,
  CandidateOutlineMetadataSchema,
} from '../implementation/schemas/candidate-outline.js';
import {
  buildCandidateGenerationPrompt,
  candidateOutlineOutputExample,
} from '../implementation/candidate-output-contract.js';

describe('candidate output protocol', () => {
  it('derives one versioned machine response that wraps the authoritative candidate schema', () => {
    expect(CandidateOutlineMetadataSchema.safeParse(candidateOutlineOutputExample).success).toBe(
      true,
    );
    expect(
      CandidateModelResponseSchema.parse({
        protocol: 'learning-more.candidate',
        schemaVersion: 1,
        outline: candidateOutlineOutputExample,
      }),
    ).toMatchObject({ outline: candidateOutlineOutputExample });
    expect(Object.keys(candidateOutlineOutputExample)).toEqual([
      'courseGoals',
      'disciplineTag',
      'topicTags',
      'modules',
      'lessons',
    ]);
  });

  it('separates the machine response protocol from user-centred learning context', () => {
    const prompt = buildCandidateGenerationPrompt({
      courseDirection: '自我与外界的冲突',
      learningApproach: '论证交锋只是一种关注重心，不限制跨玩法教学。',
      conversation: [
        { role: 'user', content: '我想通过冲突认识自己。' },
        { role: 'assistant', content: '你希望重点分析感受、价值还是行为选择？' },
      ],
      sources: [
        {
          sourceRef: 'source_topic',
          title: '初始课程方向',
          excerpt: '自我与外界的冲突',
        },
      ],
    });

    expect(prompt).toContain('[MACHINE OUTPUT CONTRACT]');
    expect(prompt).toContain('[KNOWN LEARNING BACKGROUND]');
    expect(prompt).toContain('[ORIGINAL CONVERSATION]');
    expect(prompt).toContain('"protocol":"learning-more.candidate"');
    expect(prompt).toContain('"schemaVersion":1');
    expect(prompt).toContain('"courseGoals"');
    expect(prompt).toContain('"modules"');
    expect(prompt).toContain('"lessons"');
    expect(prompt).not.toContain('outlineSessionId');
    expect(prompt).not.toContain('completedAssessmentRounds');
    expect(prompt).not.toContain('messageId');
  });
});
