// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FormalCourseView } from './formal-course-view.js';

afterEach(cleanup);

describe('FormalCourseView outline history', () => {
  it('keeps a previous outline version readable as full Markdown after a later version is current', async () => {
    const onSelectVersion = vi.fn().mockResolvedValue({
      courseId: 'course_1',
      outlineVersionId: 'outline_v1',
      sourceCandidateVersionId: 'candidate_v1',
      outlineMarkdown: '# 历史版微积分\n\n## 极限模块\n### 极限是什么',
      disciplineTag: '数学',
      topicTags: ['微积分'],
      createdAt: '2026-07-13T00:00:00.000Z',
      resourceVersion: 1,
      current: false,
    });
    render(
      <FormalCourseView
        course={{
          courseId: 'course_1',
          title: '微积分',
          status: 'active',
          courseMode: 'standard',
          outlineVersionId: 'outline_v2',
          lessonIds: [],
          outlineMarkdown: '# 当前版微积分',
          outlineVersions: [
            {
              outlineVersionId: 'outline_v1',
              sourceCandidateVersionId: 'candidate_v1',
              createdAt: '2026-07-13T00:00:00.000Z',
              current: false,
            },
            {
              outlineVersionId: 'outline_v2',
              sourceCandidateVersionId: 'candidate_v2',
              createdAt: '2026-07-14T00:00:00.000Z',
              current: true,
            },
          ],
          resourceVersion: 2,
        }}
        lessonStates={{}}
        onCloseCourse={vi.fn()}
        onDeleteCourse={vi.fn()}
        onModifyOutline={vi.fn()}
        onNavigate={vi.fn()}
        onOpenReview={vi.fn()}
        onSelectVersion={onSelectVersion}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '大纲版本记录' }));
    const historicalVersion = screen.getByText('v1 · 历史版本').closest('button');
    if (historicalVersion === null) throw new Error('missing historical outline button');
    fireEvent.click(historicalVersion);

    expect(await screen.findByRole('heading', { name: '历史版微积分' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '极限模块' })).toBeInTheDocument();
    expect(onSelectVersion).toHaveBeenCalledWith('outline_v1');
  });
});
