// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OutlineView } from './outline-view.js';

afterEach(cleanup);

describe('OutlineView', () => {
  it('does not highlight a completed lesson when a stale recommendation still points to it', () => {
    const { container } = render(
      <OutlineView
        course={{
          courseId: 'course_completed_recommendation',
          title: 'Course',
          status: 'active',
          courseMode: 'standard',
          outlineVersionId: 'outline_completed_recommendation',
          lessonIds: ['lesson_completed', 'lesson_next'],
          recommendedLessonId: 'lesson_completed',
          lessons: [
            {
              lessonId: 'lesson_completed',
              outlineVersionId: 'outline_completed_recommendation',
              title: 'Completed lesson',
              objective: 'Already completed',
              coreKnowledgePoints: [],
              prerequisiteLessonIds: [],
              estimatedMinutes: 20,
            },
            {
              lessonId: 'lesson_next',
              outlineVersionId: 'outline_completed_recommendation',
              title: 'Next lesson',
              objective: 'Continue learning',
              coreKnowledgePoints: [],
              prerequisiteLessonIds: [],
              estimatedMinutes: 20,
            },
          ],
          outlineMarkdown: '# Course\n\n## Module\n\n### Completed lesson\n\n### Next lesson',
          resourceVersion: 1,
        }}
        lessonStates={{ lesson_completed: { progress: 'completed' } }}
        onOpenLesson={vi.fn()}
      />,
    );

    expect(container.querySelector('.course-lesson--completed')).not.toHaveClass('recommended');
  });

  it('projects an authoritative completed lesson directly to its learning record', () => {
    const onOpenLesson = vi.fn();
    render(
      <OutlineView
        course={{
          courseId: 'course_completed',
          title: '微积分',
          status: 'active',
          courseMode: 'standard',
          outlineVersionId: 'outline_completed',
          lessonIds: ['lesson_completed'],
          lessons: [
            {
              lessonId: 'lesson_completed',
              outlineVersionId: 'outline_completed',
              title: '函数与图像',
              objective: '理解函数的多种表示。',
              coreKnowledgePoints: ['函数', '图像'],
              prerequisiteLessonIds: [],
              estimatedMinutes: 20,
            },
          ],
          outlineMarkdown: '# 微积分\n\n## 函数\n\n### 函数与图像',
          resourceVersion: 1,
        }}
        lessonStates={{ lesson_completed: { progress: 'completed' } }}
        onOpenLesson={onOpenLesson}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /点击查看课节记录/u }));

    expect(onOpenLesson).toHaveBeenCalledWith('lesson_completed', 'record');
    expect(screen.queryByText('学习中 · 继续学习')).not.toBeInTheDocument();
  });

  it('renders the formal lesson objective without parsing a Markdown list lead-in as its summary', () => {
    render(
      <OutlineView
        course={{
          courseId: 'course_summary',
          title: 'AI 成本',
          status: 'active',
          courseMode: 'standard',
          outlineVersionId: 'outline_summary',
          lessonIds: ['lesson_summary', 'lesson_fallback'],
          lessons: [
            {
              lessonId: 'lesson_summary',
              outlineVersionId: 'outline_summary',
              title: 'Token 怎样进入企业账单？',
              objective: '理解 token、模型服务与企业账单之间的成本链路。',
              coreKnowledgePoints: ['输入 token', '输出 token', '模型单价'],
              prerequisiteLessonIds: [],
              estimatedMinutes: 20,
            },
            {
              lessonId: 'lesson_fallback',
              outlineVersionId: 'outline_summary',
              title: '账单怎样归因？',
              objective: '建立部门、任务与模型调用之间的归因关系。',
              coreKnowledgePoints: ['部门归因', '任务归因'],
              prerequisiteLessonIds: [],
              estimatedMinutes: 20,
            },
          ],
          outlineMarkdown: `# AI 成本

## 计量与归因
### Token 怎样进入企业账单？

比较三类企业成本来源：

1. 模型调用费用
2. 云平台服务费用

### 账单怎样归因？

关键词：部门归因、任务归因`,
          resourceVersion: 1,
        }}
        lessonStates={{}}
        onOpenLesson={vi.fn()}
      />,
    );

    expect(screen.getByText('理解 token、模型服务与企业账单之间的成本链路。')).toBeInTheDocument();
    expect(screen.getByText('建立部门、任务与模型调用之间的归因关系。')).toBeInTheDocument();
    expect(screen.queryByText('比较三类企业成本来源：')).not.toBeInTheDocument();
    expect(screen.queryByText('输入 token、输出 token、模型单价。')).not.toBeInTheDocument();
    expect(screen.queryByText('部门归因、任务归因。')).not.toBeInTheDocument();
  });

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

  it('keeps a frozen lesson in the module from its bound historical outline', () => {
    render(
      <OutlineView
        course={{
          courseId: 'course_revised',
          title: 'Revised course',
          status: 'active',
          courseMode: 'standard',
          outlineVersionId: 'outline_current',
          lessonIds: ['lesson_frozen', 'lesson_current'],
          lessons: [
            {
              lessonId: 'lesson_frozen',
              outlineVersionId: 'outline_original',
              title: 'Frozen lesson',
              objective: 'Keep the completed lesson structure',
              coreKnowledgePoints: [],
              prerequisiteLessonIds: [],
              estimatedMinutes: 20,
            },
            {
              lessonId: 'lesson_current',
              outlineVersionId: 'outline_current',
              title: 'Current lesson',
              objective: 'Use the revised outline',
              coreKnowledgePoints: [],
              prerequisiteLessonIds: [],
              estimatedMinutes: 20,
            },
          ],
          outlineMarkdown: '# Revised course\n\n## Current module\n\n### Current lesson',
          resourceVersion: 2,
        }}
        lessonStates={{ lesson_frozen: { progress: 'completed' } }}
        outlineMarkdownByVersion={{
          outline_original: '# Original course\n\n## Original module one\n\n### Frozen lesson',
        }}
        onOpenLesson={vi.fn()}
      />,
    );

    const originalModule = screen.getByText('Original module one').closest('.course-module');
    expect(originalModule).not.toBeNull();
    expect(within(originalModule as HTMLElement).getByText('Frozen lesson')).toBeInTheDocument();
    expect(screen.getByText('Current module')).toBeInTheDocument();
    expect(screen.queryByText('未分组课程')).not.toBeInTheDocument();
  });

  it('uses the current confirmed outline as the stable module grouping across lesson versions', () => {
    const lesson = (lessonId: string, outlineVersionId: string, title: string) => ({
      lessonId,
      outlineVersionId,
      title,
      objective: title,
      coreKnowledgePoints: [],
      prerequisiteLessonIds: [],
      estimatedMinutes: 20,
    });
    render(
      <OutlineView
        course={{
          courseId: 'course_revised',
          title: '线性代数',
          status: 'active',
          courseMode: 'standard',
          outlineVersionId: 'outline_current',
          lessonIds: ['lesson_1', 'lesson_2', 'lesson_3', 'lesson_4', 'lesson_5'],
          lessons: [
            lesson('lesson_1', 'outline_original', '对象、条件、结论与反例'),
            lesson('lesson_2', 'outline_original', '向量：方向、位移与坐标'),
            lesson('lesson_3', 'outline_original', '线性组合：用已有方向生成新对象'),
            lesson('lesson_4', 'outline_current', '向量方程、坐标方程与几何交点'),
            lesson('lesson_5', 'outline_current', '张成空间与可达性'),
          ],
          outlineMarkdown: `# 线性代数

## 推理基础与向量语言

### 对象、条件、结论与反例
### 向量：方向、位移与坐标
### 线性组合：用已有方向生成新对象
### 向量方程、坐标方程与几何交点
### 张成空间与可达性`,
          resourceVersion: 2,
        }}
        lessonStates={{
          lesson_1: { progress: 'completed' },
          lesson_2: { progress: 'completed' },
          lesson_3: { progress: 'completed' },
          lesson_4: { progress: 'completed' },
          lesson_5: { progress: 'completed' },
        }}
        outlineMarkdownByVersion={{
          outline_original: `# 线性代数

## 数学语言与向量世界

### 对象、条件、结论与反例
### 向量：方向、位移与坐标
### 线性组合：用已有方向生成新对象`,
        }}
        onOpenLesson={vi.fn()}
      />,
    );

    const modules = document.querySelectorAll('.course-module');
    expect(modules).toHaveLength(1);
    expect(screen.getByText('推理基础与向量语言')).toBeInTheDocument();
    expect(screen.queryByText('数学语言与向量世界')).not.toBeInTheDocument();
    expect(within(modules[0] as HTMLElement).getAllByRole('button')).toHaveLength(5);
  });
});
