// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OutlineView } from './outline-view.js';

afterEach(cleanup);

describe('OutlineView', () => {
  it('renders the exact uneven module membership from saved Markdown', () => {
    const lesson = (lessonId: string, title: string) => ({
      lessonId,
      outlineVersionId: 'outline_1',
      title,
      objective: title,
      coreKnowledgePoints: [title],
      prerequisiteLessonIds: [],
      estimatedMinutes: 20,
    });
    render(
      <OutlineView
        course={{
          courseId: 'course_1',
          title: '微积分',
          status: 'active',
          courseMode: 'standard',
          outlineVersionId: 'outline_1',
          lessonIds: ['l1', 'l2', 'l3', 'l4', 'l5', 'l6'],
          lessons: [
            lesson('l1', '极限是什么'),
            lesson('l2', '连续与间断'),
            lesson('l3', '导数的定义'),
            lesson('l4', '导数的应用'),
            lesson('l5', '积分的意义'),
            lesson('l6', '微积分基本定理'),
          ],
          outlineMarkdown: `# 微积分

## 边界
### 极限是什么

## 局部变化
### 连续与间断
### 导数的定义
### 导数的应用

## 累积
### 积分的意义
### 微积分基本定理`,
          resourceVersion: 1,
        }}
        lessonStates={{}}
        onOpenLesson={vi.fn()}
      />,
    );

    const modules = document.querySelectorAll('.course-module');
    expect(modules).toHaveLength(3);
    expect(within(modules[0] as HTMLElement).getAllByRole('button')).toHaveLength(1);
    expect(within(modules[1] as HTMLElement).getAllByRole('button')).toHaveLength(3);
    expect(within(modules[2] as HTMLElement).getAllByRole('button')).toHaveLength(2);
    expect(screen.getByText('边界')).toBeInTheDocument();
    expect(screen.getByText('局部变化')).toBeInTheDocument();
    expect(screen.getByText('累积')).toBeInTheDocument();
  });

  it('places all unmatched lessons in one flat ungrouped section', () => {
    render(
      <OutlineView
        course={{
          courseId: 'course_1',
          title: '课程',
          status: 'active',
          courseMode: 'standard',
          outlineVersionId: 'outline_1',
          lessonIds: ['l1', 'l2', 'l3'],
          lessons: ['一', '二', '三'].map((title, index) => ({
            lessonId: `l${index + 1}`,
            outlineVersionId: 'outline_1',
            title,
            objective: title,
            coreKnowledgePoints: [],
            prerequisiteLessonIds: [],
            estimatedMinutes: 20,
          })),
          outlineMarkdown: '# 课程',
          resourceVersion: 1,
        }}
        lessonStates={{}}
        onOpenLesson={vi.fn()}
      />,
    );

    const ungrouped = screen.getByText('未分组课程').closest('.course-module');
    expect(ungrouped).not.toBeNull();
    expect(within(ungrouped as HTMLElement).getAllByRole('button')).toHaveLength(3);
  });
});
