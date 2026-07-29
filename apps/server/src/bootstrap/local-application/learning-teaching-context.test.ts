import { describe, expect, it } from 'vitest';

import type { LessonFinalReviewDocument } from '@learning-more/contracts';

import { projectCompletedLessonEvidence } from './learning-teaching-context.js';

describe('completed lesson evidence projection', () => {
  it('keeps semantic knowledge evidence without carrying performance prose', () => {
    const document: LessonFinalReviewDocument = {
      schemaVersion: 1,
      kind: 'lesson-final',
      title: '线性方程组',
      knowledgeMap: {
        title: '知识图谱',
        markdown: '方程等价变形保持解集。',
      },
      coreInsight: '消元通过等价变形逐步暴露未知量关系。',
      performance: [
        {
          title: '学习表现评价',
          markdown: '你能够完成消元计算。',
        },
      ],
    };

    const evidence = projectCompletedLessonEvidence(document, '旧版完整 Review');

    expect(evidence).toContain('方程等价变形保持解集');
    expect(evidence).toContain('消元通过等价变形逐步暴露未知量关系');
    expect(evidence).not.toContain('你能够完成消元计算');
    expect(evidence).not.toContain('旧版完整 Review');
  });

  it('retains legacy review markdown when no structured document exists', () => {
    expect(projectCompletedLessonEvidence(undefined, '旧版 Review 的有效内容')).toBe(
      '旧版 Review 的有效内容',
    );
  });
});
