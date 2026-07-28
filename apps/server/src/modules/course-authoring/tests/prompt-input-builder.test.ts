import { describe, expect, it } from 'vitest';

import { buildCandidateGenerationPrompt } from '../implementation/candidate-output-contract.js';
import { buildCandidatePromptInput } from '../implementation/prompt-input-builder.js';
import type { AuthoringContext } from '../ports/authoring-agent.js';

function message(
  index: number,
  role: 'user' | 'assistant',
  content: string,
): AuthoringContext['messages'][number] {
  return {
    messageId: `message_${index}`,
    role,
    content,
    status: 'complete',
    createdAt: `2026-07-28T00:${String(index).padStart(2, '0')}:00.000Z`,
  };
}

function adjustmentContext(): AuthoringContext {
  return {
    outlineSessionId: 'outline_session_compaction',
    phase: 'candidate-alignment',
    topic: '比较政治制度',
    courseMode: 'case_study',
    completedAssessmentRounds: 4,
    messages: [
      message(1, 'user', `原始要求：${'保留历史纵深'.repeat(75)}`),
      message(2, 'assistant', `首轮共识：${'以连续情境重构案例'.repeat(90)}`),
      message(3, 'user', `第一项修正：${'加强真实约束'.repeat(85)}`),
      message(4, 'assistant', `中间重复解释一：${'候选大纲已有内容'.repeat(220)}`),
      message(5, 'user', `第二项修正：${'知识链体现因果关系'.repeat(110)}`),
      message(6, 'assistant', `中间重复解释二：${'候选大纲已有内容'.repeat(220)}`),
      message(7, 'user', `第三项修正：${'允许调整未开始课节'.repeat(100)}`),
      message(8, 'assistant', `中间重复解释三：${'候选大纲已有内容'.repeat(220)}`),
      message(9, 'user', `最新要求：${'六国采用不同危机入口'.repeat(90)}`),
      message(10, 'assistant', `最终共识：${'保留稳定边界并统一调整逻辑链'.repeat(90)}`),
    ],
    materials: [],
    pastVersionContext: {
      dialogueDigest: '已压缩的原始建课对话。',
      frozenLessons: [],
    },
    candidate: {
      candidateVersionId: 'candidate_current',
      createdAt: '2026-07-28T00:04:30.000Z',
      markdown: '# 当前候选大纲\n\n## 六国比较',
    },
    pendingAlignment: {
      action: 'regenerate',
      targetModuleIds: [],
    },
  };
}

describe('candidate prompt input compaction', () => {
  it('merges unapplied dialogue and the current request within a 3,000–5,000 character budget', () => {
    const prompt = buildCandidateGenerationPrompt(buildCandidatePromptInput(adjustmentContext()));
    const adjustmentContextSection = prompt.split('[CURRENT ADJUSTMENT CONTEXT]\n')[1]!;

    expect(adjustmentContextSection.length).toBeGreaterThanOrEqual(3_000);
    expect(adjustmentContextSection.length).toBeLessThanOrEqual(5_000);
    expect(prompt).not.toContain('[CURRENT ADJUSTMENT CONVERSATION]');
    expect(prompt).not.toContain('[CURRENT REQUEST]');
    expect(adjustmentContextSection).toContain('PART 1 — CURRENT CHANGE SCOPE');
    expect(adjustmentContextSection).toContain('PART 2 — UNAPPLIED ADJUSTMENT DIALOGUE');
    for (const marker of ['第二项修正', '第三项修正', '最新要求', '中间重复解释二', '最终共识']) {
      expect(adjustmentContextSection).toContain(marker);
    }
    expect(adjustmentContextSection).not.toContain('原始要求');
    expect(adjustmentContextSection).not.toContain('第一项修正');
    expect(adjustmentContextSection).not.toContain('首轮共识');
    expect(adjustmentContextSection).not.toContain('中间重复解释一');
    expect(adjustmentContextSection).not.toContain('中间重复解释三');
  });

  it('keeps past-version context within 3,000 characters', () => {
    const context = adjustmentContext();
    const prompt = buildCandidateGenerationPrompt(
      buildCandidatePromptInput({
        ...context,
        pastVersionContext: {
          ...context.pastVersionContext!,
          dialogueDigest: `历史调整语义：${'保留既有学习边界并重构未开始课节'.repeat(500)}`,
        },
      }),
    );
    const pastVersionSection = prompt
      .split('[PAST VERSION CONTEXT]\n')[1]!
      .split('\n\n[CURRENT CANDIDATE]')[0]!;

    expect(pastVersionSection.length).toBeLessThanOrEqual(3_000);
  });

  it('does not compact the original conversation before a course has a past version', () => {
    const context = adjustmentContext();
    const initialContext = { ...context };
    delete initialContext.pastVersionContext;
    const input = buildCandidatePromptInput(initialContext);

    expect(input.conversation).toHaveLength(context.messages.length);
    expect(input.conversation.some((entry) => entry.content.includes('中间重复解释二'))).toBe(true);
  });
});
