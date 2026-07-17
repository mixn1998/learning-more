import { describe, expect, it } from 'vitest';

import { ReviewDocumentSchema, reviewDocumentToMarkdown } from './review-document.js';

describe('ReviewDocument', () => {
  it('accepts useful extensions without weakening the stable semantic slots', () => {
    const document = ReviewDocumentSchema.parse({
      schemaVersion: 1,
      kind: 'lesson-stage',
      title: '阶段 Review：理解正在形成',
      lead: '本课在形成有效证据后提前结束。',
      establishedUnderstanding: [{ title: '已建立', markdown: '能够区分两个概念。' }],
      pendingValidation: [{ title: '待验证', markdown: '还需要迁移到新情境。' }],
      knowledgeMap: { title: '当前线索', markdown: '概念 A → 判断 B' },
      performance: [{ title: '已经推进', markdown: '提出了关键反例。' }],
      continuationNotice: '恢复学习后继续验证，不新建会话。',
      modelExtension: { confidence: 'calibrated' },
    });

    expect(document.modelExtension).toEqual({ confidence: 'calibrated' });
    expect(reviewDocumentToMarkdown(document)).toContain('当前线索');
  });
});
