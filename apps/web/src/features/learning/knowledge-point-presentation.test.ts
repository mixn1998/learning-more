import { describe, expect, it } from 'vitest';

import {
  toKnowledgePointPresentation,
  toLessonKnowledgeSummary,
} from './knowledge-point-presentation.js';

describe('knowledge point presentation', () => {
  it('keeps the full point as the unique summary and derives a short title', () => {
    const source = '模型 token 是文本处理与计费单位，不是可以直接存储和转移的算力。';
    const presented = toKnowledgePointPresentation(source);

    expect(presented.title.length).toBeLessThanOrEqual(24);
    expect(presented.title).not.toBe(source);
    expect(presented.summary).toBe(source);
  });

  it('does not alter short knowledge points', () => {
    expect(toKnowledgePointPresentation('样本空间')).toEqual({
      title: '样本空间',
      summary: '样本空间',
    });
  });

  it('creates compact lesson summaries from core knowledge points', () => {
    expect(
      toLessonKnowledgeSummary([
        '平台、联盟还是开放支付：算力交易的三条路线',
        '谁和谁交易：企业、个人与 AI 智能体的机器市场',
      ]),
    ).toEqual(['平台、联盟还是开放支付', '谁和谁交易']);
  });
});
