// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LessonRecordRoute } from './lesson-record-route.js';

afterEach(cleanup);

describe('lesson record route', () => {
  it('opens the immutable Review tab from a calendar deep-link', async () => {
    const getLessonRecord = vi.fn().mockResolvedValue({
      lessonId: 'lesson_01',
      original: { sessionId: 'session_01', label: '原始学习', messages: ['原始对话'] },
      supplementary: [],
      finalReviewMarkdown: '权威最终 Review',
    });
    render(
      <MemoryRouter initialEntries={['/courses/course_01/lessons/lesson_01/record?tab=review']}>
        <Routes>
          <Route
            path="courses/:courseId/lessons/:lessonId/record"
            element={<LessonRecordRoute api={{ getLessonRecord }} />}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByLabelText('权威课时 Review')).toHaveTextContent('权威最终 Review');
    expect(getLessonRecord).toHaveBeenCalledWith('lesson_01');
  });
});
