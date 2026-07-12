// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { LearningClient } from '../../client/learning-client.js';
import { CoursePage } from './course-page.js';

afterEach(cleanup);

describe('CoursePage', () => {
  it('closes an eligible course once and exposes its immutable topic summary', async () => {
    const closeCourse = vi.fn().mockResolvedValue({
      state: 'review-finalized',
      artifactRef: 'course_review_course_01',
      resourceVersion: 2,
    });
    render(
      <CoursePage
        courseId="course_01"
        client={
          {
            closeCourse,
            getCourseReview: vi.fn().mockResolvedValue(undefined),
          } as unknown as LearningClient
        }
      />,
    );

    const close = screen.getByRole('button', { name: '确认关闭课程' });
    fireEvent.click(close);
    fireEvent.click(close);

    expect(await screen.findByRole('heading', { name: '主题总结已生成' })).toBeInTheDocument();
    expect(closeCourse).toHaveBeenCalledTimes(1);
    expect(screen.getByText('course_review_course_01')).toBeInTheDocument();
  });
});
