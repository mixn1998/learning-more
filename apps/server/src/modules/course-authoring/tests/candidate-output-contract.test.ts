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
    expect(prompt).toContain('[OUTLINE READABILITY]');
    expect(prompt).toContain('[KNOWN LEARNING BACKGROUND]');
    expect(prompt).toContain('[ORIGINAL CONVERSATION]');
    expect(prompt).toContain('"protocol":"learning-more.candidate"');
    expect(prompt).toContain('"schemaVersion":1');
    expect(prompt).toContain('"courseGoals"');
    expect(prompt).toContain('"modules"');
    expect(prompt).toContain('"lessons"');
    expect(prompt).toContain('What is the lesson name?');
    expect(prompt).toContain('What is its concise summary?');
    expect(prompt).toContain('keywords or core knowledge points');
    expect(prompt).toContain('outline.lessons[].title');
    expect(prompt).toContain('disciplineTag must be one broad academic or domain category');
    expect(prompt).toContain('**课程摘要：**');
    expect(prompt).toContain('50–100 Chinese characters');
    expect(prompt).toContain('choose the module count, lesson count');
    expect(prompt).toContain('Do not force a fixed lesson template');
    expect(prompt).not.toContain('outlineSessionId');
    expect(prompt).not.toContain('completedAssessmentRounds');
    expect(prompt).not.toContain('messageId');
  });

  it('keeps the current formal Markdown in an adjustment prompt without turning it into output fields', () => {
    const prompt = buildCandidateGenerationPrompt({
      courseDirection: '微积分',
      learningApproach: '根据学习者的调整要求继续优化。',
      conversation: [{ role: 'user', content: '强化导数应用，但保留极限模块。' }],
      sources: [{ sourceRef: 'source_topic', title: '初始课程方向', excerpt: '微积分' }],
      currentCandidate: {
        markdown: '# 微积分 v1\n\n## 极限\n### 极限是什么',
        outlineNodes: [
          {
            ref: 'module:极限',
            kind: 'module',
            title: '极限',
            excerpt: '## 极限\n### 极限是什么',
            parentRef: 'outline:root',
          },
        ],
      },
      requestedAdjustment: { action: 'patch', targetModuleIds: ['module:极限'] },
    });

    expect(prompt).toContain('[CURRENT CANDIDATE]');
    expect(prompt).toContain('# 微积分 v1\n\n## 极限\n### 极限是什么');
    expect(prompt).toContain('[CURRENT REQUEST]');
    expect(prompt).toContain('primarily concerns: 极限');
    expect(prompt).toContain('Relevant current content (极限)');
    expect(prompt).toContain('the application will disclose those changes separately');
    expect(prompt).not.toContain('[CURRENT OUTLINE NODE MANIFEST]');
    expect(prompt).not.toContain('module:极限');
    expect(prompt).not.toContain('outlineSessionId');
  });
});
