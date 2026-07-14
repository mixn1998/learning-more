import { describe, expect, it } from 'vitest';

import { projectOutlineMarkdown } from './outline-markdown-projection.js';

const lessons = [
  { lessonId: 'lesson_1', title: '极限是什么' },
  { lessonId: 'lesson_2', title: '连续与间断' },
  { lessonId: 'lesson_3', title: '导数的定义' },
  { lessonId: 'lesson_4', title: '导数的应用' },
  { lessonId: 'lesson_5', title: '积分的意义' },
  { lessonId: 'lesson_6', title: '微积分基本定理' },
] as const;

describe('projectOutlineMarkdown', () => {
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
});
