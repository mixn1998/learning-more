import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./typography.css', import.meta.url), 'utf8');

describe('AI typography contract', () => {
  it('keeps AI content and surfaces on one shared renderer with semantic spacing', () => {
    expect(css).toMatch(/\.lm-ai-content,\s*\.lm-ai-surface/);
    expect(css).toMatch(/\.lm-ai-content :where\(p, ul, ol, blockquote, pre, table\)/);
    expect(css).toMatch(/\.lm-ai-content :where\(li \+ li\)/);
    expect(css).toMatch(
      /\.lm-ai-content :where\(code, pre, kbd, samp\)[\s\S]*?var\(--lm-font-code\)/,
    );
  });
});
