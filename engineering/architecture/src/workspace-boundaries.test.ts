import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

async function files(root: string): Promise<string[]> {
  const output: string[] = [];
  const visit = async (directory: string) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (/\.(?:ts|tsx|js|jsx|mjs|cjs)$/u.test(entry.name)) output.push(absolute);
    }
  };
  await visit(root);
  return output;
}

describe('product workspace boundaries', () => {
  it('keeps operations and engineering implementations outside the product import graph', async () => {
    const projectRoot = path.resolve(import.meta.dirname, '../../..');
    const violations: string[] = [];
    for (const base of ['apps', 'packages']) {
      for (const file of await files(path.join(projectRoot, base))) {
        const content = await readFile(file, 'utf8');
        if (/(?:from\s+|import\s*\()['"][^'"]*(?:operations|engineering)[/\\]/u.test(content)) {
          violations.push(path.relative(projectRoot, file).replaceAll('\\', '/'));
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
