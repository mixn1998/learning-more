import { readFileSync } from 'node:fs';
import path from 'node:path';

import { DATA_KEYS } from '@learning-more/contracts';
import { describe, expect, it } from 'vitest';

describe('authoritative data-definition synchronization', () => {
  it('[EQ-DATA-03] keeps every registered field in the data-source definition with flow, retention, and privacy rules', () => {
    const source = readFileSync(
      path.join(process.cwd(), 'engineering/architecture/fixtures/data-source-definition.md'),
      'utf8',
    );
    const documented = new Set(
      [...source.matchAll(/^\|\s*`([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+)`\s*\|/gmu)].map(
        (match) => match[1]!,
      ),
    );
    expect([...DATA_KEYS].filter((dataKey) => !documented.has(dataKey))).toEqual([]);
    expect(source).toContain('任何与数据有关的规则改动都必须在同一个变更集中同步更新本文件');
    expect(source).toContain('数据分类与允许流向');
    expect(source).toMatch(/保留|删除|清理/u);
    expect(source).toMatch(/隐私|敏感|禁止进入/u);
  });
});
