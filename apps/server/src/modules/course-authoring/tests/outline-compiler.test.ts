import { describe, expect, it } from 'vitest';

import { compileCandidate } from '../implementation/outline-compiler.js';
import { ingestSelectedMaterial } from '../implementation/material-ingestion.js';
import { compileAssessment } from '../implementation/assessment-service.js';

const baseMetadata = {
  courseGoals: ['理解概率模型并能解释基本结果'],
  disciplineTag: '数学',
  topicTags: ['概率论', '随机变量'],
  lessons: [
    {
      id: 'lesson_probability_space',
      title: '概率空间',
      objective: '理解样本空间、事件和概率测度',
      coreKnowledgePoints: ['样本空间', '事件', '概率公理'],
      prerequisiteLessonIds: [] as string[],
      estimatedMinutes: 45,
      sourceRefs: ['source_topic'],
    },
  ],
};

function markdownFor(metadata: unknown, body = '# 概率论入门\n\n从概率空间开始建立严谨基础。') {
  return `\`\`\`learning-more-outline\n${JSON.stringify(metadata, null, 2)}\n\`\`\`\n\n${body}\n`;
}

describe('compileCandidate', () => {
  it('compiles a structurally valid metadata block and Markdown body', () => {
    const result = compileCandidate(markdownFor(baseMetadata), {
      draftArtifactRef: 'artifact_draft_01',
      sourceRefs: ['source_topic'],
    });

    expect(result).toMatchObject({
      valid: true,
      candidate: {
        disciplineTag: '数学',
        topicTags: ['概率论', '随机变量'],
        lessons: [
          {
            id: 'lesson_probability_space',
            estimatedMinutes: 45,
          },
        ],
      },
    });
  });

  it.each([
    ['missing goals', { ...baseMetadata, courseGoals: [] }, '# 正文'],
    [
      'duplicate lesson id',
      { ...baseMetadata, lessons: [baseMetadata.lessons[0], baseMetadata.lessons[0]] },
      '# 正文',
    ],
    [
      'prerequisite cycle',
      {
        ...baseMetadata,
        lessons: [
          { ...baseMetadata.lessons[0], prerequisiteLessonIds: ['lesson_second'] },
          {
            ...baseMetadata.lessons[0],
            id: 'lesson_second',
            prerequisiteLessonIds: ['lesson_probability_space'],
          },
        ],
      },
      '# 正文',
    ],
    [
      'negative duration',
      { ...baseMetadata, lessons: [{ ...baseMetadata.lessons[0], estimatedMinutes: -1 }] },
      '# 正文',
    ],
    [
      'unknown source ref',
      { ...baseMetadata, lessons: [{ ...baseMetadata.lessons[0], sourceRefs: ['unknown'] }] },
      '# 正文',
    ],
    ['script html', baseMetadata, '# 正文\n<script>alert(1)</script>'],
  ])('rejects %s as an untrusted candidate draft', (_name, metadata, body) => {
    expect(
      compileCandidate(markdownFor(metadata, body), {
        draftArtifactRef: 'artifact_invalid',
        sourceRefs: ['source_topic'],
      }),
    ).toMatchObject({ valid: false, draftArtifactRef: 'artifact_invalid' });
  });

  it('reports an important reading section that no lesson maps to', () => {
    expect(
      compileCandidate(markdownFor(baseMetadata), {
        draftArtifactRef: 'artifact_reading',
        sourceRefs: ['source_topic', 'material:chapter_important'],
        requiredSourceRefs: ['material:chapter_important'],
      }),
    ).toMatchObject({
      valid: false,
      issues: [
        { path: 'lessons.sourceRefs', message: expect.stringContaining('chapter_important') },
      ],
    });
  });
});

describe('ingestSelectedMaterial', () => {
  it('ingests explicitly selected UTF-8 Markdown with immutable provenance', async () => {
    const bytes = new TextEncoder().encode('# 第一章\n内容\n## 1.1 小节\n更多内容');

    const result = await ingestSelectedMaterial(
      { fileName: '概率论.md', mediaType: 'text/markdown', bytes },
      { now: () => new Date('2026-07-13T00:00:00.000Z') },
    );

    expect(result).toMatchObject({
      valid: true,
      snapshot: {
        originalFileName: '概率论.md',
        format: 'markdown',
        importedAt: '2026-07-13T00:00:00.000Z',
        parserVersion: 'material-ingestion-v1',
        sections: [{ title: '第一章' }, { title: '1.1 小节' }],
      },
    });
    if (result.valid) expect(result.snapshot.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects oversized text and encrypted or scanned PDFs explicitly', async () => {
    await expect(
      ingestSelectedMaterial(
        {
          fileName: 'too-large.txt',
          mediaType: 'text/plain',
          bytes: new Uint8Array(2 * 1024 * 1024 + 1),
        },
        {},
      ),
    ).resolves.toMatchObject({ valid: false, code: 'material_too_large' });

    for (const failure of ['encrypted', 'no-text'] as const) {
      await expect(
        ingestSelectedMaterial(
          { fileName: 'book.pdf', mediaType: 'application/pdf', bytes: new Uint8Array([1, 2, 3]) },
          { pdfExtractor: async () => ({ failure }) },
        ),
      ).resolves.toMatchObject({
        valid: false,
        code: failure === 'encrypted' ? 'material_pdf_encrypted' : 'material_pdf_text_unavailable',
      });
    }
  });
});

describe('compileAssessment', () => {
  it('preserves user facts and AI inferences as distinct evidence kinds', () => {
    const result = compileAssessment(
      {
        summary: '学习者希望理解概率论，并可能需要复习集合基础。',
        readiness: 'sufficient',
        evidence: [
          { kind: 'user_fact', statement: '希望理解概率论', sourceRef: 'user:topic' },
          {
            kind: 'ai_inference',
            statement: '可能需要复习集合基础',
            sourceRef: 'ai:assessment_01',
          },
        ],
      },
      { allowedSourceRefs: ['user:topic', 'ai:assessment_01'] },
    );

    expect(result).toMatchObject({ valid: true });
    expect(
      compileAssessment(
        {
          summary: '错误地把推断伪装为用户事实',
          readiness: 'sufficient',
          evidence: [
            { kind: 'user_fact', statement: '学习者基础薄弱', sourceRef: 'ai:assessment_01' },
          ],
        },
        { allowedSourceRefs: ['ai:assessment_01'] },
      ),
    ).toMatchObject({ valid: false });
  });
});
