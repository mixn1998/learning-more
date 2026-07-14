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
  });

  it('rejects a non-ISO learning activity timestamp', () => {
    expect(() => HomeDashboardResponseSchema.parse(dashboard('07/12 20:30'))).toThrow();
  });
});
