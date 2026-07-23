import { describe, expect, it } from 'vitest';

import { LessonRecordResponseSchema } from './learning-session.js';

const baseRecord = {
  lessonId: 'lesson_01',
  courseId: 'course_01',
  title: '课时',
  courseTitle: '课程',
  completedAt: '2026-07-15T00:00:00.000Z',
  actualSeconds: 60,
  progress: 'completed' as const,
  reviewKind: 'final' as const,
  reviewStatus: 'ready' as const,
  original: {
    sessionId: 'session_01',
    label: '原始学习',
    messages: [{ id: 'message_01', role: 'user' as const, markdown: '导师：只是正文' }],
  },
  supplementary: [],
  finalReviewMarkdown: 'Review',
};

describe('lesson record contract', () => {
  it('carries explicit message roles without encoding them into visible text', () => {
    const record = LessonRecordResponseSchema.parse(baseRecord);

    expect(record.original.messages[0]).toEqual({
      id: 'message_01',
      role: 'user',
      markdown: '导师：只是正文',
    });
  });

  it('rejects the legacy role-prefixed string representation', () => {
    expect(() =>
      LessonRecordResponseSchema.parse({
        ...baseRecord,
        original: { ...baseRecord.original, messages: ['你：旧格式'] },
      }),
    ).toThrow();
  });

  it('carries a failed final Review reason and retry target', () => {
    const record = LessonRecordResponseSchema.parse({
      ...baseRecord,
      reviewStatus: 'failed',
      reviewErrorCode: 'review_evidence_pack_incomplete',
      reviewRetry: {
        transactionId: 'closure_01',
        resourceVersion: 2,
      },
      finalReviewMarkdown: undefined,
    });

    expect(record).toMatchObject({
      reviewKind: 'final',
      reviewStatus: 'failed',
      reviewErrorCode: 'review_evidence_pack_incomplete',
      reviewRetry: { transactionId: 'closure_01', resourceVersion: 2 },
    });
  });
});
