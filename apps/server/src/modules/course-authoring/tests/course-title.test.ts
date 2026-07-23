import { describe, expect, it } from 'vitest';

import { extractOutlineMainTitle, resolveCourseTitle } from '../model/course-title.js';

describe('course title projection', () => {
  it('uses the first outline H1 and ignores headings inside code fences', () => {
    const markdown = [
      '```markdown',
      '# Internal example',
      '```',
      '# **Calculus in Motion**',
      '',
    ].join('\n');

    expect(extractOutlineMainTitle(markdown)).toBe('Calculus in Motion');
  });

  it('falls back to the original topic only when the outline has no H1', () => {
    expect(resolveCourseTitle('## Module one', ' original user topic ')).toBe(
      'original user topic',
    );
  });
});
