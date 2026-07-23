import { describe, expect, it } from 'vitest';

import { buildOutlineSemanticManifest } from '../implementation/outline-semantic-manifest.js';

describe('outline semantic manifest', () => {
  it('separates modules, flat lessons, and course-level completion criteria', () => {
    const manifest = buildOutlineSemanticManifest(`# 微积分

## 极限与连续
### 极限是什么

## 一次看懂导数
从变化率理解导数。

## 课程完成标准
用自己的语言解释极限、连续与导数之间的关系。`);

    expect(manifest.map(({ ref, kind }) => [ref, kind])).toEqual([
      ['outline:root', 'course'],
      ['module:极限与连续', 'module'],
      ['lesson:极限与连续/极限是什么', 'lesson'],
      ['lesson:ungrouped/一次看懂导数', 'lesson'],
      ['section:课程完成标准', 'course-section'],
    ]);
  });
});
