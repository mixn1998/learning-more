// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FormalCourseView } from './formal-course-view.js';

afterEach(cleanup);

describe('FormalCourseView outline history', () => {
  it('renders only the saved outline title and selected introduction paragraph', () => {
    const outlineMarkdown = `# 微积分：从直观变化到严格推导

这是一门以一元微积分为主线的系统入门课。

每课遵循大致相同的思维路径：

**直观问题 → 数学定义 → 公式推导 → 典型例题 → 理解检查**

哲学旁注只在“无限与有限”这样的关键处出现。

预计总学习时间约为 **38—45 小时**。

## 模块一：总地图
### 极限是什么`;
    render(
      <FormalCourseView
        course={{
          courseId: 'course_calculus',
          title: '微积分',
          status: 'active',
          courseMode: 'standard',
          outlineVersionId: 'outline_calculus',
          lessonIds: [],
          outlineMarkdown,
          resourceVersion: 1,
        }}
        currentOutline={{
          courseId: 'course_calculus',
          outlineVersionId: 'outline_calculus',
          sourceCandidateVersionId: 'candidate_calculus',
          outlineMarkdown,
          disciplineTag: '数学·一元微积分',
          topicTags: ['函数', '极限', '连续性', '导数', '积分'],
          createdAt: '2026-07-15T00:00:00.000Z',
          resourceVersion: 1,
          current: true,
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

    expect(
      screen.getByRole('heading', { name: '微积分：从直观变化到严格推导' }),
    ).toBeInTheDocument();
    expect(screen.getByText('这是一门以一元微积分为主线的系统入门课。').tagName).toBe('P');
    expect(screen.queryByText('每课遵循大致相同的思维路径：')).not.toBeInTheDocument();
    expect(
      screen.queryByText('直观问题 → 数学定义 → 公式推导 → 典型例题 → 理解检查'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/哲学旁注/u)).not.toBeInTheDocument();
    expect(screen.queryByText(/38—45 小时/u)).not.toBeInTheDocument();
    expect(screen.queryByText(/函数、极限、连续性、导数、积分/u)).not.toBeInTheDocument();
  });

  it('renders a deterministic introduction when the saved outline has no introductory prose', () => {
    render(
      <FormalCourseView
        course={{
          courseId: 'course_legacy',
          title: '数据分析',
          status: 'active',
          courseMode: 'standard',
          outlineVersionId: 'outline_legacy',
          lessonIds: ['lesson_metrics', 'lesson_diagnosis'],
          lessons: [
            {
              lessonId: 'lesson_metrics',
              outlineVersionId: 'outline_legacy',
              title: '建立指标',
              objective: '理解指标结构。',
              coreKnowledgePoints: [],
              prerequisiteLessonIds: [],
              estimatedMinutes: 20,
            },
            {
              lessonId: 'lesson_diagnosis',
              outlineVersionId: 'outline_legacy',
              title: '定位变化',
              objective: '诊断数据变化。',
              coreKnowledgePoints: [],
              prerequisiteLessonIds: [],
              estimatedMinutes: 20,
            },
          ],
          outlineMarkdown: `# 数据分析进阶

## 数据基础
### 建立指标

## 诊断方法
### 定位变化`,
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

    expect(screen.getByRole('heading', { name: '数据分析进阶' })).toBeInTheDocument();
    expect(screen.getByText('这是一门关于“数据分析进阶”的课程。')).toBeInTheDocument();
    expect(screen.queryByText('数据基础 → 诊断方法')).not.toBeInTheDocument();
  });

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
