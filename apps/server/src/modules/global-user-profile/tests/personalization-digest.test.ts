import { describe, expect, it } from 'vitest';

import {
  createPersonalizationDigestSource,
  renderPersonalizationDigest,
} from '../implementation/personalization-digest.js';

describe('personalization digest', () => {
  it('deduplicates re-abstracted dimensions and projects selected stable modes without truncation', () => {
    const source = createPersonalizationDigestSource({
      profileVersion: 3,
      items: [
        {
          sourceId: 'dimension_1',
          kind: 'stable_dimension',
          summary: '倾向先比较条件再修正判断。',
          teachingImpact: '通过对比和反例组织讲解',
          priority: 5,
          supportingSessionCount: 3,
          sourceRefs: ['session:1', 'session:2'],
        },
        {
          sourceId: 'dimension_2',
          kind: 'stable_dimension',
          summary: '倾向先比较条件再修正判断',
          teachingImpact: '通过对比和反例组织讲解',
          priority: 4,
          supportingSessionCount: 2,
          sourceRefs: ['session:3', 'session:4'],
        },
        {
          sourceId: 'preference_1',
          kind: 'durable_preference',
          summary: '希望复杂概念使用反例说明',
          teachingImpact: '复杂概念优先加入反例',
          priority: 5,
          supportingSessionCount: 0,
          sourceRefs: ['message:1'],
        },
      ],
    });
    const digest = renderPersonalizationDigest(source);
    expect(digest.summary).toContain('用户在不同学习会话中稳定表现为');
    expect(digest.summary).toContain('用户明确偏好');
    expect(digest.summary.match(/倾向先比较条件再修正判断/gu)).toHaveLength(1);
    expect(digest.selectedModeIds).toEqual(['dimension_1', 'preference_1']);
  });

  it('does not invent context when no stable source exists', () => {
    expect(
      renderPersonalizationDigest(
        createPersonalizationDigestSource({ profileVersion: 0, items: [] }),
      ),
    ).toEqual({ summary: '', selectedModeIds: [] });
  });
});
