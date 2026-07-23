import { describe, expect, it } from 'vitest';

import { renderAuthoringConversationInput } from '../implementation/generation-authoring-agent.js';
import type { AuthoringContext } from '../ports/authoring-agent.js';

function context(): AuthoringContext {
  return {
    outlineSessionId: 'outline_session_internal',
    phase: 'candidate-alignment',
    topic: '理解 token 是否可能成为货币',
    courseMode: 'case_study',
    completedAssessmentRounds: 4,
    messages: [
      {
        messageId: 'message_internal_1',
        role: 'user',
        content: '我想理解 token 会不会成为一种货币。',
        status: 'complete',
        createdAt: '2026-07-14T00:00:00.000Z',
      },
      {
        messageId: 'message_internal_2',
        role: 'assistant',
        content: '你更关心货币机制还是投资判断？',
        status: 'complete',
        createdAt: '2026-07-14T00:01:00.000Z',
      },
      {
        messageId: 'message_internal_3',
        role: 'user',
        content: '请把第二模块改成对稳定币失败案例的分析。',
        status: 'complete',
        createdAt: '2026-07-14T00:02:00.000Z',
        alignmentAction: 'patch',
        targetModuleIds: ['module_internal_2'],
      },
    ],
    materials: [
      {
        sourceRef: 'artifact:internal-material-id',
        title: '稳定币材料.md',
        excerpt: '材料正文',
      },
    ],
    candidate: {
      candidateVersionId: 'candidate_internal_1',
      markdown: '# 当前课程大纲',
    },
    pendingAlignment: { action: 'patch', targetModuleIds: ['module_internal_2'] },
  };
}

describe('authoring conversation expression context', () => {
  it('separates user words from natural-language background without exposing control state', () => {
    const rendered = renderAuthoringConversationInput(context());

    expect(rendered).toContain('【已知学习背景】');
    expect(rendered).toContain('【当前诉求｜用户原话】');
    expect(rendered).toContain('请把第二模块改成对稳定币失败案例的分析。');
    expect(rendered).toContain('【当前候选大纲】\n# 当前课程大纲');
    expect(rendered).toContain('《稳定币材料.md》\n材料正文');
    expect(rendered.match(/请把第二模块改成对稳定币失败案例的分析。/gu)).toHaveLength(1);

    for (const internalValue of [
      'outlineSessionId',
      'outline_session_internal',
      'phase',
      'completedAssessmentRounds',
      'courseMode',
      'candidateVersionId',
      'candidate_internal_1',
      'pendingAlignment',
      'sourceRef',
      'artifact:internal-material-id',
      'message_internal_3',
      'module_internal_2',
    ]) {
      expect(rendered).not.toContain(internalValue);
    }
  });
});
