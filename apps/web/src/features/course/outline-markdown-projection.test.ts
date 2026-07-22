import { describe, expect, it } from 'vitest';

import {
  projectOutlineMarkdown,
  resolveCourseIntroduction,
} from './outline-markdown-projection.js';

const lessons = [
  { lessonId: 'lesson_1', title: '极限是什么' },
  { lessonId: 'lesson_2', title: '连续与间断' },
  { lessonId: 'lesson_3', title: '导数的定义' },
  { lessonId: 'lesson_4', title: '导数的应用' },
  { lessonId: 'lesson_5', title: '积分的意义' },
  { lessonId: 'lesson_6', title: '微积分基本定理' },
] as const;

describe('projectOutlineMarkdown', () => {
  it('extracts only the explicit 50–100 character course summary after the H1', () => {
    const summary =
      '本课程围绕一元微积分的核心概念与推理方法展开，结合图像直觉、公式计算和严格证明，帮助学习者建立可迁移的数学思维与后续学习基础。';
    const projection = projectOutlineMarkdown(`# 微积分：从直观变化到严格推导

**课程摘要：** ${summary}

每课遵循大致相同的思维路径：

**直观问题 → 数学定义 → 公式推导 → 典型例题 → 理解检查**

哲学旁注只在“无限与有限”这样的关键处出现。

预计总学习时间约为 **38—45 小时**。

## 模块一：总地图
### 极限是什么`);

    expect(projection.title).toBe('微积分：从直观变化到严格推导');
    expect(projection.introductionText).toBe(summary);
  });

  it('does not treat legacy introduction labels or ordinary prose as a generated course summary', () => {
    const projection = projectOutlineMarkdown(`# 企业 AI 成本

学习路径：先计量，再归因，最后优化。

课程介绍：理解 **token**、[模型服务](https://example.com/model) 与企业账单的关系，并建立可操作的成本分析框架。

## 模块一：理解计量
### Token 是什么`);

    expect(projection.introductionText).toBeUndefined();
  });

  it('does not guess a legacy summary from a later narrative paragraph', () => {
    const projection = projectOutlineMarkdown(`# AI Token 会成为企业“成本硬通货”吗？

这门课不预设“AI 成本管理一定值得创业”，而是检验一个更具行动价值的问题：

- 企业是否真的需要独立的 AI 成本管理？
- 这个问题能否形成可持续的产品机会？

课程从企业账单、使用行为和产品决策三个层面建立可验证的 AI 成本判断。

## 模块一：成本从哪里产生
### Token 是成本单位吗？`);

    expect(projection.introductionText).toBeUndefined();
  });

  it('rejects an explicitly labelled summary outside the 50–100 character range', () => {
    expect(
      projectOutlineMarkdown(`# 简短摘要

**课程摘要：** 这段摘要太短。

## 第一模块`).introductionText,
    ).toBeUndefined();
    expect(
      projectOutlineMarkdown(`# 过长摘要

**课程摘要：** ${'课程摘要需要保持聚焦并避免把完整大纲重新搬进课程头部。'.repeat(5)}

## 第一模块`).introductionText,
    ).toBeUndefined();
  });

  it('rejects schedule and weekly-effort copy before using the title fallback', () => {
    const projection = projectOutlineMarkdown(`# 从哲学思维走向严格数学：微积分基础课程

这是一条建议用 12 周、每周约 10 小时完成的主线，也可以按掌握情况延长到 14～16 周。课程不以赶完章节为目标，而以形成可迁移的数学能力为目标：

- 理解极限与连续
- 掌握导数和积分的严格推导

## 模块一：极限与连续
### 极限是什么？`);

    expect(projection.introductionText).toBeUndefined();
    expect(resolveCourseIntroduction(projection, '备用课程名')).toEqual({
      title: '备用课程名',
      introductionText: '这是一门关于“备用课程名”的课程。',
    });
  });

  it('uses one neutral sentence when a heading-only outline has no eligible introduction', () => {
    const projection = projectOutlineMarkdown(`# 微积分

## 极限与连续
### 极限是什么

## 导数与应用
### 导数的定义`);

    expect(projection.introductionText).toBeUndefined();
    expect(resolveCourseIntroduction(projection, '备用课程名')).toEqual({
      title: '备用课程名',
      introductionText: '这是一门关于“备用课程名”的课程。',
    });
  });

  it('preserves uneven module sizes from the saved Markdown', () => {
    const projection = projectOutlineMarkdown(
      `# 微积分

## 先理解变化的边界
### 极限是什么

## 从局部变化到函数行为
### 连续与间断
### 导数的定义
### 导数的应用

## 累积如何连接变化
### 积分的意义
### 微积分基本定理`,
      lessons,
    );

    expect(projection.title).toBe('微积分');
    expect(projection.modules.map((module) => module.title)).toEqual([
      '先理解变化的边界',
      '从局部变化到函数行为',
      '累积如何连接变化',
    ]);
    expect(
      projection.modules.map((module) => module.lessons.map((lesson) => lesson.lessonId)),
    ).toEqual([['lesson_1'], ['lesson_2', 'lesson_3', 'lesson_4'], ['lesson_5', 'lesson_6']]);
    expect(projection.ungroupedLessons).toEqual([]);
  });

  it('recognizes list lessons under their nearest Markdown module', () => {
    const projection = projectOutlineMarkdown(
      `# 微积分

## 建立变化语言
1. 极限是什么
2. 连续与间断

## 进入微分
- 导数的定义
- 导数的应用`,
      lessons.slice(0, 4),
    );

    expect(projection.modules).toHaveLength(2);
    expect(projection.modules[0]?.lessons.map((lesson) => lesson.lessonId)).toEqual([
      'lesson_1',
      'lesson_2',
    ]);
    expect(projection.modules[1]?.lessons.map((lesson) => lesson.lessonId)).toEqual([
      'lesson_3',
      'lesson_4',
    ]);
  });

  it('keeps unmatched formal lessons flat instead of inventing groups', () => {
    const projection = projectOutlineMarkdown(
      `# 微积分

## 唯一可识别模块
### 极限是什么`,
      lessons.slice(0, 3),
    );

    expect(projection.modules).toHaveLength(1);
    expect(projection.modules[0]?.lessons.map((lesson) => lesson.lessonId)).toEqual(['lesson_1']);
    expect(projection.ungroupedLessons.map((lesson) => lesson.lessonId)).toEqual([
      'lesson_2',
      'lesson_3',
    ]);
  });

  it('does not treat a top-level lesson heading as a made-up module', () => {
    const projection = projectOutlineMarkdown(
      `# 微积分

## 极限是什么
## 连续与间断`,
      lessons.slice(0, 2),
    );

    expect(projection.modules).toEqual([]);
    expect(projection.ungroupedLessons.map((lesson) => lesson.lessonId)).toEqual([
      'lesson_1',
      'lesson_2',
    ]);
  });

  it('projects an unconfirmed candidate from explicit heading hierarchy', () => {
    const projection = projectOutlineMarkdown(`# 新版微积分

## 极限与连续
### 从逼近理解极限
### 连续意味着什么

## 微分
- 导数作为局部变化率`);

    expect(
      projection.modules.map((module) => ({
        title: module.title,
        lessons: module.lessons.map((lesson) => lesson.title),
      })),
    ).toEqual([
      { title: '极限与连续', lessons: ['从逼近理解极限', '连续意味着什么'] },
      { title: '微分', lessons: ['导数作为局部变化率'] },
    ]);
  });

  it('keeps course completion criteria as a course-level section instead of lessons', () => {
    const projection = projectOutlineMarkdown(`# 微积分

## 极限与连续
### 极限是什么

## 课程完成标准

1. 用自己的语言解释极限、连续、导数与积分的关系。
2. 在图像、公式、数表和自然语言之间转换同一数学对象。
3. 稳定完成核心极限、求导和基础积分计算。`);

    expect(projection.modules.map((module) => module.title)).toEqual(['极限与连续']);
    expect(projection.modules[0]?.lessons.map((lesson) => lesson.title)).toEqual(['极限是什么']);
    expect(projection.courseSections.map((section) => section.title)).toEqual(['课程完成标准']);
    expect(projection.ungroupedLessons).toEqual([]);
  });

  it('keeps paragraph-only completion criteria course-level while retaining flat H2 lessons', () => {
    const projection = projectOutlineMarkdown(`# Calculus

## A First Look at Limits
Understand approaching values through a graph.

## Course Completion Criteria
Explain limits and continuity in your own words.`);

    expect(projection.ungroupedLessons.map((lesson) => lesson.title)).toEqual([
      'A First Look at Limits',
    ]);
    expect(projection.courseSections.map((section) => section.title)).toEqual([
      'Course Completion Criteria',
    ]);
  });
});
