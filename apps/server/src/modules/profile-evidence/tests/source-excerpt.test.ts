import { describe, expect, it, vi } from 'vitest';

import { readTransientSourceExcerpts } from '../implementation/source-excerpt.js';

describe('on-demand source excerpts', () => {
  it('[EQ-POR-05] reads only a few exact refs into sanitized bounded transient excerpts', async () => {
    const readSource = vi.fn(async (sourceRef: string) => `<b>${sourceRef}</b> ${'x'.repeat(50)}`);
    const excerpts = await readTransientSourceExcerpts({
      sourceRefs: ['message:1', 'review:2', 'message:1', 'outline:3', 'review:4'],
      readSource,
      maxSources: 2,
      maxCharactersPerSource: 20,
    });

    expect(readSource).toHaveBeenCalledTimes(2);
    expect(excerpts).toEqual([
      { sourceRef: 'message:1', excerpt: 'message:1 xxxxxxxxxx' },
      { sourceRef: 'review:2', excerpt: 'review:2 xxxxxxxxxxx' },
    ]);
    expect(Object.isFrozen(excerpts)).toBe(true);
  });
});
