import { describe, expect, it } from 'vitest';

import { HomeDashboardResponseSchema } from './home.js';

function dashboard(lastActivityAt: string) {
  return {
    generatedAt: '2026-07-13T00:00:00.000Z',
    draftSessions: [],
    courses: [],
    lessons: [
      {
        courseId: 'course_01',
        lessonId: 'lesson_01',
        title: 'Evidence and feedback',
        objective: 'Use evidence to revise a judgment.',
        coreKnowledgePoints: ['evidence', 'counter-evidence'],
        estimatedMinutes: 35,
        progress: 'in_progress',
        sessionId: 'session_01',
        recommended: true,
        lastActivityAt,
      },
    ],
    schedule: [],
  };
}

describe('home dashboard contract', () => {
  it('carries the latest real learning activity timestamp for a lesson', () => {
    const parsed = HomeDashboardResponseSchema.parse(dashboard('2026-07-12T12:30:00.000Z'));

    expect(parsed.lessons[0]?.lastActivityAt).toBe('2026-07-12T12:30:00.000Z');
    expect(parsed.lessons[0]).toMatchObject({
      objective: 'Use evidence to revise a judgment.',
      coreKnowledgePoints: ['evidence', 'counter-evidence'],
      estimatedMinutes: 35,
    });
  });

  it('rejects a non-ISO learning activity timestamp', () => {
    expect(() => HomeDashboardResponseSchema.parse(dashboard('07/12 20:30'))).toThrow();
  });

  it('carries confirmed-outline topic tags with each course', () => {
    const input = dashboard('2026-07-12T12:30:00.000Z');
    const parsed = HomeDashboardResponseSchema.parse({
      ...input,
      courses: [
        {
          courseId: 'course_01',
          title: 'Evidence and feedback',
          status: 'active',
          courseMode: 'standard',
          outlineVersionId: 'outline_01',
          disciplineTag: 'learning science',
          topicTags: ['evidence', 'counter-evidence'],
          resourceVersion: 1,
        },
      ],
    });

    expect(parsed.courses[0]).toMatchObject({
      disciplineTag: 'learning science',
      topicTags: ['evidence', 'counter-evidence'],
    });
  });
});
