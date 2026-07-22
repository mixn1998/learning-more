import { describe, expect, it } from 'vitest';

import { ReviewDocumentSchema, reviewDocumentToMarkdown } from './review-document.js';

describe('ReviewDocument', () => {
  it('renders an optional methodology insight immediately after the knowledge map', () => {
    const document = ReviewDocumentSchema.parse({
      schemaVersion: 1,
      kind: 'lesson-final',
      title: '课时 Review',
      knowledgeMap: { title: '知识图谱', markdown: '条件 → 判断 → 行动' },
      methodologyInsight: '先找出会改变结论的条件，再决定是否沿用原有判断。',
      coreInsight: '本课讨论如何根据条件变化修正判断。',
      performance: [{ title: '已经形成', markdown: '能够检查关键条件。' }],
    });

    const markdown = reviewDocumentToMarkdown(document);
    expect(markdown).toContain('## 本课方法论启示');
    expect(markdown.indexOf('## 本课方法论启示')).toBeGreaterThan(markdown.indexOf('## 知识图谱'));
    expect(markdown.indexOf('## 本课方法论启示')).toBeLessThan(markdown.indexOf('## 核心思想'));
  });

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
