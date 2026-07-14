import type { ReasoningDimensionDefinition } from '@learning-more/contracts';
import { describe, expect, it } from 'vitest';

import { reconcileReasoningDimensions } from '../implementation/reasoning-dimension-reconciler.js';

const association: ReasoningDimensionDefinition = {
  dimensionId: 'reasoning_dimension_association',
  dimensionSetVersion: 'dimension_set_previous',
  label: '关系机制推演',
  description: '通过机制连接对象并推进判断。',
  inclusionSignals: ['说明关系机制', '解释后果'],
  exclusionSignals: ['仅做并列罗列'],
  derivedFromEpisodeIds: ['episode_1'],
  semanticFingerprint: 'a'.repeat(64),
  analyzerVersion: 'analyzer@1',
  createdAt: '2026-07-14T00:00:00.000Z',
  status: 'active',
};

describe('reconcileReasoningDimensions', () => {
  it('continues a renamed dimension when its evidence signals overlap', () => {
    const [result] = reconcileReasoningDimensions({
      activeDimensions: [association],
      drafts: [
        {
          label: '机制关联推理',
          description: '使用关系机制说明后果。',
          inclusionSignals: ['说明关系机制', '解释后果'],
          exclusionSignals: ['仅做并列罗列'],
          derivedFromEpisodeIds: ['episode_1', 'episode_2'],
        },
      ],
    });

    expect(result).toMatchObject({ dimensionId: association.dimensionId });
  });

  it('creates a lineage for a genuinely new evidence pattern', () => {
    const [result] = reconcileReasoningDimensions({
      activeDimensions: [association],
      drafts: [
        {
          label: '隐喻建模',
          description: '借助隐喻重构问题。',
          inclusionSignals: ['建立跨域隐喻'],
          exclusionSignals: ['仅重复原有表述'],
          derivedFromEpisodeIds: ['episode_3'],
        },
      ],
    });

    expect(result?.dimensionId).not.toBe(association.dimensionId);
    expect(result?.supersedesDimensionIds).toEqual([]);
  });
});
