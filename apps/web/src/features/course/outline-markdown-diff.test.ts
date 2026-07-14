import { describe, expect, it } from 'vitest';

import { diffOutlineMarkdown } from './outline-markdown-diff.js';

describe('diffOutlineMarkdown', () => {
  it('reports unchanged, modified, added, and removed content without fixed grouping', () => {
    const diff = diffOutlineMarkdown(
      `# 原课程

## 基础
### 保持的课
原内容
### 调整的课
旧内容
### 删除的课
不再需要

## 被删除的模块
### 旧模块课节`,
      `# 新课程

## 基础
### 保持的课
原内容
### 调整的课
新内容
### 新增的课
新内容

## 新增模块
### 新模块课节`,
    );

    const base = diff.modules.find((module) => module.title === '基础');
    expect(base?.status).toBe('modified');
    expect(base?.lessons.map((lesson) => [lesson.title, lesson.status])).toEqual([
      ['保持的课', 'unchanged'],
      ['调整的课', 'modified'],
      ['新增的课', 'added'],
      ['删除的课', 'removed'],
    ]);
    expect(diff.modules.find((module) => module.title === '新增模块')?.status).toBe('added');
    expect(diff.modules.find((module) => module.title === '被删除的模块')?.status).toBe('removed');
  });

  it('uses removed plus added when renamed structures cannot be matched reliably', () => {
    const diff = diffOutlineMarkdown(
      '# 课程\n\n## 旧主题\n### 旧课节',
      '# 课程\n\n## 全新领域\n### 全新课节',
    );

    expect(diff.modules.map((module) => module.status)).toEqual(['added', 'removed']);
  });
});
