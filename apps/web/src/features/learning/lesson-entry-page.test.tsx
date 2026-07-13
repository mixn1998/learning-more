// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { LearningClient } from '../../client/learning-client.js';
import { LessonEntryPage } from './lesson-entry-page.js';

afterEach(cleanup);

describe('LessonEntryPage', () => {
  it('[EQ-SCH-04] shows confirmed core knowledge before creating a learning session', async () => {
    const start = vi.fn().mockResolvedValue({
      lessonId: 'lesson_01',
      sessionId: 'session_01',
      resourceVersion: 1,
      writable: true,
      leaseToken: 'lease_01',
    });
    const client = {
      getLessonPreview: vi.fn().mockResolvedValue({
        lessonId: 'lesson_01',
        courseId: 'course_01',
        outlineVersionId: 'outline_01',
        title: 'Probability spaces',
        objective: 'Understand probability spaces',
        coreKnowledgePoints: ['sample space', 'event algebra'],
        estimatedMinutes: 30,
      }),
      start,
      getSession: vi.fn().mockResolvedValue({
        resourceVersion: 1,
        learning: { progress: 'in_progress', session: { state: 'active' } },
      }),
    } as unknown as LearningClient;

    render(<LessonEntryPage lessonId="lesson_01" client={client} />);

    expect(await screen.findByRole('heading', { name: 'Probability spaces' })).toBeInTheDocument();
    expect(screen.getByText('sample space')).toBeInTheDocument();
    expect(screen.getByText('event algebra')).toBeInTheDocument();
    expect(start).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '开始学习' }));
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
  });
});
