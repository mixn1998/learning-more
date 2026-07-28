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

function semanticSeries(label: string, detail: string, count: number): string {
  return Array.from(
    { length: count },
    (_, index) => `${label}${index + 1}明确${detail}的第${index + 1}个独立边界。`,
  ).join('');
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
      message(5, 'user', semanticSeries('第二项修正', '知识链需要体现因果关系', 90)),
      message(6, 'assistant', semanticSeries('第二项共识摘要', '确认知识链需要体现因果关系', 90)),
      message(7, 'user', semanticSeries('第三项修正', '需要允许调整未开始课节', 90)),
      message(8, 'assistant', semanticSeries('第三项共识摘要', '确认允许调整未开始课节', 90)),
      message(9, 'user', semanticSeries('最新要求', '六国需要采用不同危机入口', 90)),
      message(10, 'assistant', semanticSeries('最终共识', '确认保留边界并统一逻辑链', 90)),
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
    expect(adjustmentContextSection).not.toContain('[中间重复展开已压缩]');
    expect(adjustmentContextSection).toContain('PART 1 — CURRENT CHANGE SCOPE');
    expect(adjustmentContextSection).toContain('PART 2 — UNAPPLIED ADJUSTMENT DIALOGUE');
    for (const marker of ['第二项共识摘要', '第三项共识摘要', '最新要求', '最终共识']) {
      expect(adjustmentContextSection).toContain(marker);
    }
    expect(adjustmentContextSection).not.toContain('原始要求');
    expect(adjustmentContextSection).not.toContain('第一项修正');
    expect(adjustmentContextSection).not.toContain('首轮共识');
    expect(adjustmentContextSection).not.toContain('中间重复解释一');
    expect(adjustmentContextSection).not.toContain('第二项修正');
    expect(adjustmentContextSection).not.toContain('第三项修正');
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
    expect(input.conversation.some((entry) => entry.content.includes('第二项修正'))).toBe(true);
  });
});
