// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FormalCourseView } from './formal-course-view.js';

afterEach(cleanup);

describe('FormalCourseView outline history', () => {
  it('uses the saved-outline summary for the recommended lesson card', () => {
    render(
      <FormalCourseView
        course={{
          courseId: 'course_summary',
          title: 'AI 成本',
          status: 'active',
          courseMode: 'standard',
          outlineVersionId: 'outline_summary',
          lessonIds: ['lesson_summary'],
          recommendedLessonId: 'lesson_summary',
          lessons: [
            {
              lessonId: 'lesson_summary',
              outlineVersionId: 'outline_summary',
              title: 'Token 怎样进入企业账单？',
              objective: '建立 AI 调用与企业成本之间的关系。',
              coreKnowledgePoints: ['输入 token', '输出 token', '模型单价'],
              prerequisiteLessonIds: [],
              estimatedMinutes: 20,
            },
          ],
          outlineMarkdown: `# AI 成本

## 计量
### Token 怎样进入企业账单？

摘要：理解 token、模型服务与企业账单之间的成本链路。`,
          resourceVersion: 1,
        }}
        lessonStates={{}}
        onCloseCourse={vi.fn()}
        onDeleteCourse={vi.fn()}
        onModifyOutline={vi.fn()}
        onNavigate={vi.fn()}
        onOpenReview={vi.fn()}
        onSelectVersion={vi.fn()}
      />,
    );

    expect(screen.getAllByText('理解 token、模型服务与企业账单之间的成本链路。')).toHaveLength(2);
    expect(screen.queryByText('输入 token、输出 token、模型单价。')).not.toBeInTheDocument();
  });

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
