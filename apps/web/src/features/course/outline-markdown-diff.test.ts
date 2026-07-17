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

  it('keeps course-level completion criteria out of the module and lesson diff', () => {
    const diff = diffOutlineMarkdown(
      '# 微积分\n\n## 极限\n### 极限是什么',
      '# 微积分\n\n## 极限\n### 极限是什么\n\n## 课程完成标准\n1. 解释极限与连续的关系。',
    );

    expect(diff.modules.map((module) => module.title)).toEqual(['极限']);
    expect(diff.courseSections.map((section) => [section.title, section.status])).toEqual([
      ['课程完成标准', 'added'],
    ]);
  });

  it('recognizes a renamed and reordered lesson as a modification instead of delete plus add', () => {
    const diff = diffOutlineMarkdown(
      '# 课程\n\n## 基础\n### 极限入门\n理解趋近。\n### 连续性\n理解连续。',
      '# 课程\n\n## 基础\n### 连续性\n理解连续。\n### 从趋近理解极限\n理解趋近。',
    );

    const lessons = diff.modules[0]?.lessons ?? [];
    expect(lessons.map((lesson) => lesson.status)).toEqual(['modified', 'modified']);
    expect(lessons[0]?.changeKinds).toContain('moved');
    expect(lessons[1]?.changeKinds).toEqual(expect.arrayContaining(['renamed', 'moved']));
  });

  it('keeps a renamed or moved target attributed to the request through its previous anchor', () => {
    const diff = diffOutlineMarkdown(
      '# 课程\n\n## 基础\n### 极限入门\n理解趋近。\n\n## 应用\n### 连续性\n理解连续。',
      '# 课程\n\n## 基础\n### 连续性\n理解连续。\n\n## 应用\n### 从趋近理解极限\n理解趋近。',
      undefined,
      { action: 'patch', targetNodeRefs: ['lesson:基础/极限入门'] },
    );

    const moved = diff.modules
      .flatMap((module) => module.lessons)
      .find((lesson) => lesson.title === '从趋近理解极限');
    expect(moved).toMatchObject({ attribution: 'requested', status: 'modified' });
    expect(moved?.changeKinds).toEqual(expect.arrayContaining(['renamed', 'moved']));
  });

  it('labels out-of-target changes as AI-synchronised without rejecting them', () => {
    const diff = diffOutlineMarkdown(
      '# 课程\n\n## 基础\n### 第一课\n旧内容\n\n## 应用\n### 第二课\n旧内容',
      '# 课程\n\n## 基础\n### 第一课\n新内容\n\n## 应用\n### 第二课\n也被调整',
      undefined,
      { action: 'patch', targetNodeRefs: ['module:基础'] },
    );

    expect(diff.modules.find((module) => module.title === '基础')?.attribution).toBe('requested');
    expect(diff.modules.find((module) => module.title === '应用')?.attribution).toBe('ai_sync');
  });
});
