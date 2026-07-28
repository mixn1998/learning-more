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
    expect(prompt).toContain('"knowledgeStructure"');
    expect(prompt).toContain('one intelligible main logic chain');
    expect(prompt).toContain('learner-facing teaching knowledge point');
    expect(prompt).toContain('shortest complete meaning');
    expect(prompt).toContain('双侧极限的单侧判据');
    expect(prompt).toContain('Put the reasoning between knowledge points');
    expect(prompt).toContain('state the concrete inferential need');
    expect(prompt).toContain('Do not use generic placeholders such as');
    expect(prompt).toContain('为下一步理解提供基础');
    expect(prompt).not.toContain('concise yet reveal why the node matters');
    expect(prompt).toContain('Do not turn branches into separate progress steps');
    expect(prompt).toContain('outline.lessons[].title');
    expect(prompt).toContain(
      'disciplineTag must be one recognizable academic discipline or domain at the most specific stable level supported by the course',
    );
    expect(prompt).toContain('政治、经济、社会、心理、历史、法律');
    expect(prompt).toContain(
      'Use a broader umbrella category only when the course genuinely spans multiple disciplines or cannot be classified reliably.',
    );
    expect(prompt).not.toContain('Do not use a detailed course topic, subfield');
    expect(prompt).toContain('**课程摘要：**');
    expect(prompt).toContain('50–100 Chinese characters');
    expect(prompt).toContain('Its presentation is not fixed');
    expect(prompt).toContain('module count, lesson count');
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
      pastVersionContext: {
        dialogueDigest: '用户目标与边界：希望掌握极限、导数及其应用；已经确认保留极限模块。',
        frozenLessons: [
          {
            lessonId: 'lesson_limit',
            semanticKey: 'lesson_limit',
            title: '极限是什么',
            objective: '理解极限如何描述趋近过程',
            coreKnowledgePoints: ['趋近', '极限'],
            knowledgeStructure: {
              mainChain: [
                { id: 'node_1', content: '趋近', relationToNext: '形成' },
                { id: 'node_2', content: '极限' },
              ],
              branches: [],
            },
            progress: 'completed',
          },
        ],
      },
    });

    expect(prompt).toContain('[CURRENT CANDIDATE]');
    expect(prompt).toContain('# 微积分 v1\n\n## 极限\n### 极限是什么');
    expect(prompt).toContain('[CURRENT ADJUSTMENT CONTEXT]');
    expect(prompt).toContain('PART 1 — CURRENT CHANGE SCOPE');
    expect(prompt).toContain('PART 2 — UNAPPLIED ADJUSTMENT DIALOGUE');
    expect(prompt).toContain('primarily concerns: 极限');
    expect(prompt).not.toContain('Relevant current content (极限)');
    expect(prompt).not.toContain('[CURRENT REQUEST]');
    expect(prompt).not.toContain('[CURRENT ADJUSTMENT CONVERSATION]');
    expect(prompt).toContain('the application will disclose those changes separately');
    expect(prompt).not.toContain('[CURRENT OUTLINE NODE MANIFEST]');
    expect(prompt).not.toContain('module:极限');
    expect(prompt).not.toContain('outlineSessionId');
    expect(prompt).toContain('[PAST VERSION CONTEXT]');
    expect(prompt).toContain('PART 1 — HISTORICAL AUTHORING DECISIONS');
    expect(prompt).toContain('希望掌握极限、导数及其应用');
    expect(prompt).toContain('PART 2 — FROZEN STARTED-LESSON ANCHORS');
    expect(prompt).toContain('completed | lesson_limit | 极限是什么');
    expect(prompt).toContain('Do not rename, rewrite, replace, or duplicate it');
  });
});
