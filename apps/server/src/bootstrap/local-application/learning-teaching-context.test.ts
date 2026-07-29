import { describe, expect, it } from 'vitest';

import type { LessonFinalReviewDocument } from '@learning-more/contracts';

import {
  createLearningTeachingContext,
  projectPreviousLessonCoreInsight,
} from './learning-teaching-context.js';

describe('previous lesson evidence projection', () => {
  it('keeps only the structured review core insight', () => {
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

    const evidence = projectPreviousLessonCoreInsight(document, '旧版完整 Review');

    expect(evidence).toBe('消元通过等价变形逐步暴露未知量关系。');
    expect(evidence).not.toContain('方程等价变形保持解集');
    expect(evidence).not.toContain('你能够完成消元计算');
    expect(evidence).not.toContain('旧版完整 Review');
  });

  it('extracts only the core insight from a legacy review', () => {
    expect(
      projectPreviousLessonCoreInsight(
        undefined,
        '# Review\n\n## 核心思想\n\n等价变形保持解集。\n\n## 学习表现评价\n\n你完成了练习。',
      ),
    ).toBe('等价变形保持解集。');
  });

  it('does not inject an unstructured legacy review', () => {
    expect(projectPreviousLessonCoreInsight(undefined, '旧版 Review 的完整正文')).toBe(undefined);
  });

  it('loads evidence only from the immediately previous lesson', async () => {
    const sha256 = 'a'.repeat(64);
    const reviewDocument = (title: string): LessonFinalReviewDocument => ({
      schemaVersion: 1,
      kind: 'lesson-final',
      title,
      knowledgeMap: { title: '知识图谱', markdown: `${title}知识图谱` },
      coreInsight: `${title}核心思想`,
      performance: [{ title: '学习表现评价', markdown: `${title}学习表现` }],
    });
    const createRecord = (lessonId: string) => ({
      lessonId,
      learning: {
        lessonId,
        progress: 'completed' as const,
        processedCommandIds: [],
      },
      intervals: [],
      finalReview: {
        id: `review_${lessonId}`,
        artifactRef: `artifact_${lessonId}`,
        contentSha256: sha256,
        sourceSessionIds: [],
        messageRangeChecksum: sha256,
        committedAt: '2026-07-29T00:00:00.000Z',
        document: reviewDocument(lessonId),
      },
      resourceVersion: 1,
    });
    type LearningContextInput = Parameters<typeof createLearningTeachingContext>[0];
    const sources = createLearningTeachingContext({
      course: {
        async *listLessons() {
          yield { id: 'lesson_1', title: '第一课', objective: '第一课目标' };
          yield { id: 'lesson_2', title: '第二课', objective: '第二课目标' };
          yield { id: 'lesson_3', title: '第三课', objective: '第三课目标' };
        },
      } as unknown as LearningContextInput['course'],
      getLearningRecord: (async (lessonId: string) =>
        createRecord(lessonId)) as LearningContextInput['getLearningRecord'],
      listMessages: (async () => []) as LearningContextInput['listMessages'],
      artifactStore: {
        read: async () => undefined,
        readDraft: async () => undefined,
      } as LearningContextInput['artifactStore'],
    });

    const reviews = await sources.listRelevantFinalReviews('course_1', 'lesson_3');

    expect(reviews).toEqual([
      expect.objectContaining({
        sourceRef: 'review:review_lesson_2',
        markdown: 'lesson_2核心思想',
      }),
    ]);
    expect(JSON.stringify(reviews)).not.toContain('lesson_1');
    expect(JSON.stringify(reviews)).not.toContain('知识图谱');
    expect(JSON.stringify(reviews)).not.toContain('学习表现');
  });
});
