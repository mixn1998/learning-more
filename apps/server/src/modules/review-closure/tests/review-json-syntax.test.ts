import { describe, expect, it } from 'vitest';

import { parseJsonWithSyntaxRepair } from '../implementation/review-json-syntax.js';

describe('parseJsonWithSyntaxRepair', () => {
  it('keeps valid JSON unchanged', () => {
    expect(parseJsonWithSyntaxRepair('{"kind":"lesson-final","performance":[]}')).toEqual({
      kind: 'lesson-final',
      performance: [],
    });
  });

  it('repairs a prematurely closed root object without inventing content', () => {
    const source =
      '{"schemaVersion":1,"kind":"lesson-final","title":"Review","knowledgeMap":{"title":"Map","markdown":"A → B"},"coreInsight":"Insight"},"performance":[{"title":"Done","markdown":"Evidence"}]}';

    expect(parseJsonWithSyntaxRepair(source)).toEqual({
      schemaVersion: 1,
      kind: 'lesson-final',
      title: 'Review',
      knowledgeMap: { title: 'Map', markdown: 'A → B' },
      coreInsight: 'Insight',
      performance: [{ title: 'Done', markdown: 'Evidence' }],
    });
  });

  it('does not merge ambiguous or duplicate fragments', () => {
    const source = '{"kind":"lesson-final"},"kind":"course-final"}';
    expect(parseJsonWithSyntaxRepair(source)).not.toEqual({ kind: 'course-final' });
  });
});
